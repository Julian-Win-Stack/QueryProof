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
// Batch E experiment axes (2026-07-31), each defaulting to the published
// configuration so an unset variable can never change a number:
//   PICKER_PROMPT=picker-v1|picker-v2   which prompt the llm picker runs
//   EXPAND=on|off        join-partner expansion after the llm picker
//   SQL_CONTEXT=rows,values,desc        extras in the SQL prompt (comma list)
//   PICKER_CONTEXT=values,desc          extras in the picker prompt
//   CHECK=off|probe|self post-execution check (src/check.ts)
// All five throw inside the bake-off — its variants are frozen at the D9
// configuration.
//
// Batch F axis (2026-07-31):
//   VOTE=N               best-of-N by execution agreement (src/vote.ts): N
//                        attempts per question, largest group of same-rows
//                        results wins. 2-9; unset or "off" means one attempt.
//                        Throws with CHECK — that interaction is unmeasured.
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
import { applyCheck, type CheckAction, type CheckMode } from '../src/check.ts';
import { compareRows } from '../src/compare-rows.ts';
import { executeReadOnly } from '../src/execute-readonly.ts';
import { EFFORT, MODEL, usdCost } from '../src/model.ts';
import { expandWithJoinPartners } from '../src/pickers/expand.ts';
import { keywordPick } from '../src/pickers/keyword.ts';
import { llmPick, PICKER_V1, type PickerPrompt } from '../src/pickers/llm.ts';
import {
  buildPickerExtras,
  buildSqlExtras,
  PICKER_CONTEXT_KINDS,
  SQL_CONTEXT_KINDS,
  type PickerContextKind,
  type SqlContextKind,
} from '../src/schema-extras.ts';
import { loadSchema, renderSchema, tablesForDbId, type Table } from '../src/schema.ts';
import { extractGoldTables, recallHit } from '../src/table-recall.ts';
import { voteAnswer } from '../src/vote.ts';
import { CHECK_PROMPT_VERSION } from '../src/prompts/check-v1.ts';
import * as pickerV2 from '../src/prompts/picker-v2.ts';
import { PROMPT_VERSION } from '../src/generate-sql.ts';

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

// Batch E axes. Every reader throws on an unknown value, and every non-default
// value throws unless the configuration it modifies is actually in play — a
// variable that silently does nothing is how a run gets mislabeled.
const PICKER_PROMPT: PickerPrompt = readPickerPrompt();
const EXPAND: boolean = readExpand();
const SQL_CONTEXT: SqlContextKind[] = readContext('SQL_CONTEXT', SQL_CONTEXT_KINDS);
const PICKER_CONTEXT: PickerContextKind[] = readContext('PICKER_CONTEXT', PICKER_CONTEXT_KINDS);
const CHECK: CheckMode = readCheck();
const VOTE: number = readVote();

function requireLlmPicker(name: string): void {
  if (MODE !== 'hard' || PICKER !== 'llm' || BAKEOFF) {
    throw new Error(`${name} modifies the llm picker: EVAL_MODE=hard PICKER=llm, outside the bake-off`);
  }
}

function requireOutsideBakeoff(name: string): void {
  if (BAKEOFF) {
    throw new Error(`${name} with EVAL_PICKERS=1 — the bake-off variants are frozen at the D9 configuration`);
  }
}

function readPickerPrompt(): PickerPrompt {
  const value = process.env.PICKER_PROMPT;
  if (value === undefined || value === 'picker-v1') return PICKER_V1;
  if (value !== 'picker-v2') throw new Error(`PICKER_PROMPT="${value}" — picker-v1 or picker-v2`);
  requireLlmPicker('PICKER_PROMPT=picker-v2');
  return {
    version: pickerV2.PICKER_PROMPT_VERSION,
    system: pickerV2.PICKER_SYSTEM,
    buildMessage: pickerV2.buildPickerMessage,
  };
}

function readExpand(): boolean {
  const value = process.env.EXPAND;
  if (value === undefined || value === 'off') return false;
  if (value !== 'on') throw new Error(`EXPAND="${value}" — on or off`);
  requireLlmPicker('EXPAND=on');
  return true;
}

function readContext<Kind extends string>(name: string, known: Kind[]): Kind[] {
  const value = process.env[name];
  if (value === undefined || value === '') return [];
  const kinds = value.split(',').map((part) => part.trim());
  for (const kind of kinds) {
    if (!known.some((candidate) => candidate === kind)) {
      throw new Error(`${name}="${value}" — a comma list from: ${known.join(', ')}`);
    }
  }
  if (name === 'PICKER_CONTEXT') requireLlmPicker('PICKER_CONTEXT');
  else requireOutsideBakeoff(name);
  return kinds as Kind[];
}

function readCheck(): CheckMode {
  const value = process.env.CHECK;
  if (value === undefined || value === 'off') return 'off';
  if (value !== 'probe' && value !== 'self') throw new Error(`CHECK="${value}" — off, probe or self`);
  requireOutsideBakeoff(`CHECK=${value}`);
  return value;
}

function readVote(): number {
  const value = process.env.VOTE;
  if (value === undefined || value === 'off') return 1;
  const votes = Number(value);
  if (!Number.isInteger(votes) || votes < 2 || votes > 9) {
    throw new Error(`VOTE="${value}" — an integer from 2 to 9, or off`);
  }
  requireOutsideBakeoff(`VOTE=${value}`);
  if (CHECK !== 'off') {
    throw new Error(`VOTE=${value} with CHECK=${CHECK} — the interaction is unmeasured, run one at a time`);
  }
  return votes;
}

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

// Built once per process, for the whole catalog; null when the axis is off so
// the published configurations never touch the extra queries.
const sqlExtras: Promise<Map<string, string>> | null =
  SQL_CONTEXT.length > 0 ? allTables.then((tables) => buildSqlExtras(tables, SQL_CONTEXT)) : null;
const pickerExtras: Promise<Map<string, string>> | null =
  PICKER_CONTEXT.length > 0 ? allTables.then((tables) => buildPickerExtras(tables, PICKER_CONTEXT)) : null;

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
  expand: string;
  sqlContext: string;
  pickerContext: string;
  check: string;
  // What the check actually did on this question — 'skipped' when the trigger
  // never fired. Always 'skipped' when check is off.
  checkAction: CheckAction;
  vote: number;
  // Attempts in the winning group; null when voting is off, 0 when no attempt
  // executed cleanly and the last failure shipped.
  voteAgreement: number | null;
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

  const picked = await llmPick(
    record.question,
    catalog,
    PICKER_PROMPT,
    pickerExtras === null ? undefined : await pickerExtras,
  );
  return {
    tables: EXPAND ? expandWithJoinPartners(picked.tables, catalog) : picked.tables,
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

  const schemaText = renderSchema(selection.tables, sqlExtras === null ? undefined : await sqlExtras);
  const answerParams = {
    question: record.question,
    evidence: record.evidence,
    schemaText,
    repair: REPAIR,
  };
  const voted = VOTE > 1 ? await voteAnswer({ ...answerParams, votes: VOTE }) : null;
  const generated = voted ?? (await answerQuestion(answerParams));
  const answer = await applyCheck(
    CHECK,
    { question: record.question, evidence: record.evidence, schemaText },
    generated,
  );
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
    expand: EXPAND ? 'on' : 'off',
    sqlContext: SQL_CONTEXT.join(','),
    pickerContext: PICKER_CONTEXT.join(','),
    check: CHECK,
    checkAction: answer.checkAction,
    vote: VOTE,
    voteAgreement: voted === null ? null : voted.voteAgreement,
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
  ...(BAKEOFF || PICKER === 'llm' ? [`pickerPrompt=${PICKER_PROMPT.version}`] : []),
  ...(EXPAND ? ['expand=on'] : []),
  ...(SQL_CONTEXT.length > 0 ? [`sqlContext=${SQL_CONTEXT.join(',')}`] : []),
  ...(PICKER_CONTEXT.length > 0 ? [`pickerContext=${PICKER_CONTEXT.join(',')}`] : []),
  ...(CHECK !== 'off' ? [`check=${CHECK} ${CHECK_PROMPT_VERSION}`] : []),
  ...(VOTE > 1 ? [`vote=${VOTE}`] : []),
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
