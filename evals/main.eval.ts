// The one eval file. Configuration arrives by environment variable (D8) —
// evalite's CLI accepts no custom flags, and a second eval file is how the
// EASY and HARD paths silently drift apart.
//
//   EVAL_MODE=easy|hard  easy: db_id -> tables (the yardstick). hard: a picker
//                        chooses out of all 75.
//   PICKER=none|keyword|llm  hard mode only, and required there — "none" (all
//                        75 tables, the Batch D baseline) has to be said, not
//                        arrived at by forgetting. Meaningless in easy mode,
//                        so setting it there throws.
//   EVAL_PICKERS=1       the D9 bake-off: keyword vs llm as evalite.each
//                        variants, one run, dev slice only.
//   REPAIR=on|off        Phase 7 self-repair: up to 2 retries on a Postgres
//                        error, hard mode only. Defaults to off.
//   EVAL_DEV=1           filter to the frozen 100-id dev slice
//   LIMIT=N              first N questions only — wiring smoke, never evidence
//   TRIALS / CONCURRENCY read in evalite.config.ts
//
// EVAL_MODE and EVAL_DEV, not the MODE and DEV the plan wrote: vite owns both
// names and sets them inside every worker (MODE="test", DEV="1"), so a run
// configured with them silently reads vite's values — the first eval:easy run
// filtered itself to the dev slice that way and was voided.
//
// A question that never reaches a scorable answer — a 429 that survives every
// retry, a safety refusal, gold SQL failing to execute — throws, so evalite
// records it as an errored item with no score. That is a *void* (D12b, D19):
// counted next to the accuracy figure, never scored 0. If the count is not
// zero, the run's verdict in RUNS.md is void.

import { readFileSync } from 'node:fs';

import { evalite } from 'evalite';

import { answerQuestion } from '../src/answer.ts';
import { compareRows } from '../src/compare-rows.ts';
import { executeReadOnly } from '../src/execute-readonly.ts';
import { EFFORT, MODEL, usdCost } from '../src/model.ts';
import { keywordPick } from '../src/pickers/keyword.ts';
import { llmPick } from '../src/pickers/llm.ts';
import { loadSchema, renderSchema, tablesForDbId, type Table } from '../src/schema.ts';
import { extractGoldTables, recallHit } from '../src/table-recall.ts';
import { PICKER_PROMPT_VERSION } from '../src/prompts/picker-v1.ts';
import { PROMPT_VERSION } from '../src/prompts/v1.ts';

const GOLD_PATH = new URL('../gold/validated.json', import.meta.url);
const SLICE_PATH = new URL('./dev-slice.json', import.meta.url);

type GoldRecord = {
  id: string;
  db_id: string;
  difficulty: string;
  question: string;
  evidence: string;
  sql: string;
  rowCount: number;
};

type PickerName = 'none' | 'keyword' | 'llm';
const PICKER_NAMES: PickerName[] = ['none', 'keyword', 'llm'];

// The gateway caches, and a cached repeat run reports zero variance — a fake
// noise floor. Eval runs call Anthropic directly, always.
if (process.env.PRODUCT_PATH === '1') {
  throw new Error('PRODUCT_PATH=1 routes through the Respan gateway — eval runs never do. Unset it.');
}

const MODE = process.env.EVAL_MODE ?? 'easy';
if (MODE !== 'easy' && MODE !== 'hard') {
  throw new Error(`EVAL_MODE="${MODE}" — easy or hard`);
}
const DEV = process.env.EVAL_DEV === '1';
const BAKEOFF = process.env.EVAL_PICKERS === '1';
// A limited run exists to prove the wiring, not to measure anything. It is
// stamped into the run name so its number can never read as a real one.
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : undefined;

// A misconfigured run must crash here, before any money is spent — the
// alternative is a plausible number measured under a config nobody chose,
// which is how the first eval:easy run got voided.
const PICKER: PickerName = readPicker();
const REPAIR: boolean = readRepair();

function readRepair(): boolean {
  const value = process.env.REPAIR;
  if (value === undefined || value === 'off') return false;
  if (value !== 'on') throw new Error(`REPAIR="${value}" — on or off`);
  if (MODE !== 'hard' || BAKEOFF) {
    throw new Error('REPAIR=on is the Phase 7 row: EVAL_MODE=hard, outside the bake-off');
  }
  return true;
}

function readPicker(): PickerName {
  const value = process.env.PICKER;
  if (BAKEOFF) {
    if (MODE !== 'hard' || !DEV) {
      throw new Error('EVAL_PICKERS=1 is the D9 bake-off: EVAL_MODE=hard on the dev slice only');
    }
    if (value !== undefined) {
      throw new Error(`PICKER="${value}" with EVAL_PICKERS=1 — the bake-off always runs keyword and llm`);
    }
    return 'none'; // unused: the variant carries the picker
  }
  if (MODE === 'easy') {
    if (value !== undefined) {
      throw new Error(`PICKER="${value}" in easy mode — easy takes tables from db_id, a picker never runs`);
    }
    return 'none';
  }
  const picker = PICKER_NAMES.find((name) => name === value);
  if (!picker) {
    throw new Error(
      `EVAL_MODE=hard needs an explicit PICKER (${PICKER_NAMES.join(' | ')}), got ${value === undefined ? 'nothing' : `"${value}"`} — "none" means all 75 tables and has to be said, not defaulted into`,
    );
  }
  return picker;
}

function loadQuestions(): GoldRecord[] {
  const parsed: unknown = JSON.parse(readFileSync(GOLD_PATH, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${GOLD_PATH.pathname} is not a JSON array — run npm run validate-gold`);
  }
  const gold = parsed as GoldRecord[];
  if (!DEV) return gold;

  const sliceIds = new Set(JSON.parse(readFileSync(SLICE_PATH, 'utf8')) as string[]);
  const slice = gold.filter((record) => sliceIds.has(record.id));
  if (slice.length !== sliceIds.size) {
    throw new Error(`dev slice names ${sliceIds.size} ids but only ${slice.length} are in gold/validated.json`);
  }
  return slice;
}

function limited(records: GoldRecord[]): GoldRecord[] {
  return LIMIT === undefined ? records : records.slice(0, LIMIT);
}

const allTables = loadSchema();

// Everything a failure needs to be diagnosed without a re-run (Phase 5b).
// Rows never land here — validated.json stores no result fingerprint, and an
// export carrying full result sets would dwarf the store.
type QuestionResult = {
  correct: boolean;
  generatedSql: string;
  attempts: number;
  lastPgError: string | null;
  rowsReturned: number | null;
  goldRowCount: number;
  columnCountMatch: boolean | null;
  tablesSent: string[];
  tablesGoldNeeded: string[];
  recallHit: boolean;
  tokensIn: number;
  tokensOut: number;
  thinkingTokens: number;
  // The picker's own call, zero for easy / none / keyword. usd is the whole
  // question — generation plus picker — so cost-per-correct (E4) stays honest
  // when the llm picker is in play.
  pickerTokensIn: number;
  pickerTokensOut: number;
  pickerMs: number;
  usd: number;
  modelMs: number;
  executionMs: number;
  // The per-row copy of the run configuration (D11): a single exported result
  // is self-describing.
  mode: string;
  picker: string;
  repair: string;
  promptVersion: string;
  pickerPromptVersion: string;
  model: string;
  effort: string;
};

type Selection = {
  tables: Table[];
  pickerTokensIn: number;
  pickerTokensOut: number;
  pickerUsd: number;
  pickerMs: number;
  pickerPromptVersion: string;
};

async function selectTables(record: GoldRecord, picker: PickerName): Promise<Selection> {
  const catalog = await allTables;
  const free = { pickerTokensIn: 0, pickerTokensOut: 0, pickerUsd: 0, pickerMs: 0, pickerPromptVersion: '' };

  if (MODE === 'easy') return { tables: tablesForDbId(record.db_id, catalog), ...free };
  if (picker === 'none') return { tables: catalog, ...free };
  if (picker === 'keyword') return { tables: keywordPick(record.question, catalog), ...free };

  const picked = await llmPick(record.question, catalog);
  return {
    tables: picked.tables,
    pickerTokensIn: picked.usage.inputTokens,
    pickerTokensOut: picked.usage.outputTokens,
    pickerUsd: usdCost(picked.usage),
    pickerMs: picked.ms,
    pickerPromptVersion: picked.promptVersion,
  };
}

async function runQuestion(record: GoldRecord, picker: PickerName): Promise<QuestionResult> {
  const catalog = await allTables;
  const selection = await selectTables(record, picker);

  const answer = await answerQuestion({
    question: record.question,
    evidence: record.evidence,
    schemaText: renderSchema(selection.tables),
    repair: REPAIR,
  });
  const execution = answer.execution;

  // Gold SQL failing is infrastructure — every gold query was validated
  // against this database. Throwing voids the question instead of letting a
  // broken environment read as a wrong model answer.
  const gold = await executeReadOnly(record.sql);
  if (!gold.ok) {
    throw new Error(`gold SQL for ${record.id} failed: ${gold.errorCode ?? 'no code'} — ${gold.errorMessage}`);
  }

  const correct = execution.ok && compareRows(execution.rows, gold.rows);

  const tablesSent = selection.tables.map((table) => table.name);
  // Throws on a name it does not recognize (D7) — that voids the question
  // loudly, because a confused extractor must never report a quiet hit.
  const tablesGoldNeeded = extractGoldTables(record.sql, new Set(catalog.map((table) => table.name)));

  return {
    correct,
    generatedSql: answer.sql,
    attempts: answer.attempts,
    lastPgError: execution.ok ? null : `${execution.errorCode ?? 'no code'} — ${execution.errorMessage}`,
    rowsReturned: execution.ok ? execution.rows.length : null,
    goldRowCount: gold.rows.length,
    columnCountMatch: execution.ok ? (execution.rows[0]?.length ?? 0) === (gold.rows[0]?.length ?? 0) : null,
    tablesSent,
    tablesGoldNeeded,
    recallHit: recallHit(tablesGoldNeeded, tablesSent),
    tokensIn: answer.usage.inputTokens,
    tokensOut: answer.usage.outputTokens,
    thinkingTokens: answer.usage.thinkingTokens,
    pickerTokensIn: selection.pickerTokensIn,
    pickerTokensOut: selection.pickerTokensOut,
    pickerMs: selection.pickerMs,
    usd: usdCost(answer.usage) + selection.pickerUsd,
    modelMs: answer.modelMs,
    executionMs: answer.executionMs,
    mode: MODE,
    picker: MODE === 'easy' ? 'none' : picker,
    repair: REPAIR ? 'on' : 'off',
    promptVersion: answer.promptVersion,
    pickerPromptVersion: selection.pickerPromptVersion,
    model: MODEL,
    effort: EFFORT,
  };
}

const runName = [
  MODE,
  `slice=${DEV ? 'dev' : 'full'}${LIMIT === undefined ? '' : ` | limit=${LIMIT}`}`,
  `picker=${BAKEOFF ? 'bakeoff' : PICKER}`,
  ...(REPAIR ? ['repair=on'] : []),
  `prompt=${PROMPT_VERSION}`,
  ...(BAKEOFF || PICKER === 'llm' ? [`pickerPrompt=${PICKER_PROMPT_VERSION}`] : []),
  `effort=${EFFORT}`,
  MODEL,
].join(' | ');

const options = {
  data: () =>
    limited(loadQuestions()).map((record) => ({
      input: record,
      expected: record.sql,
    })),

  scorers: [
    {
      name: 'same-rows',
      scorer: ({ output }: { output: QuestionResult }) => (output.correct ? 1 : 0),
    },
    {
      name: 'table-recall',
      scorer: ({ output }: { output: QuestionResult }) => (output.recallHit ? 1 : 0),
    },
  ],

  columns: ({ input, output }: { input: GoldRecord; output: QuestionResult }) => [
    { label: 'id', value: `${input.id} (${input.difficulty})` },
    { label: 'sql', value: output.generatedSql },
    { label: 'pg error', value: output.lastPgError ?? '' },
    { label: 'rows', value: `${output.rowsReturned ?? '—'} vs ${output.goldRowCount}` },
    { label: 'tables', value: `${output.tablesSent.length} sent, recall ${output.recallHit ? 'hit' : 'MISS'}` },
    { label: 'attempts', value: String(output.attempts) },
    { label: 'tokens', value: `${output.tokensIn} in, ${output.tokensOut} out` },
  ],
};

if (BAKEOFF) {
  evalite.each([
    { name: 'keyword', input: 'keyword' as PickerName },
    { name: 'llm', input: 'llm' as PickerName },
  ])(runName, {
    ...options,
    task: (record: GoldRecord, picker: PickerName) => runQuestion(record, picker),
  });
} else {
  evalite(runName, {
    ...options,
    task: (record: GoldRecord) => runQuestion(record, PICKER),
  });
}
