// The one eval file. Configuration arrives by environment variable (D8) —
// evalite's CLI accepts no custom flags, and a second eval file is how the
// EASY and HARD paths silently drift apart.
//
//   EVAL_MODE=easy       db_id -> tables (the yardstick). HARD arrives with Phase 6.
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

import { compareRows } from '../src/compare-rows.ts';
import { executeReadOnly } from '../src/execute-readonly.ts';
import { generateSql } from '../src/generate-sql.ts';
import { EFFORT, MODEL, usdCost } from '../src/model.ts';
import { loadSchema, renderSchema, tablesForDbId } from '../src/schema.ts';
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

const MODE = process.env.EVAL_MODE ?? 'easy';
if (MODE !== 'easy') {
  throw new Error(`EVAL_MODE="${MODE}" — only "easy" exists until Phase 6 builds table selection`);
}
const DEV = process.env.EVAL_DEV === '1';
// A limited run exists to prove the wiring, not to measure anything. It is
// stamped into the run name so its number can never read as a real one.
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : undefined;

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
  // Measured from Phase 6a. null means "not measured", never "hit".
  recallHit: null;
  tokensIn: number;
  tokensOut: number;
  thinkingTokens: number;
  usd: number;
  modelMs: number;
  executionMs: number;
  // The per-row copy of the run configuration (D11): a single exported result
  // is self-describing.
  mode: string;
  picker: string;
  repair: string;
  promptVersion: string;
  model: string;
  effort: string;
};

evalite(
  `${MODE} | slice=${DEV ? 'dev' : 'full'}${LIMIT === undefined ? '' : ` | limit=${LIMIT}`} | picker=none | prompt=${PROMPT_VERSION} | effort=${EFFORT} | ${MODEL}`,
  {
  data: () =>
    limited(loadQuestions()).map((record) => ({
      input: record,
      expected: record.sql,
    })),

  task: async (record): Promise<QuestionResult> => {
    const tables = tablesForDbId(record.db_id, await allTables);

    const generated = await generateSql({
      question: record.question,
      evidence: record.evidence,
      schemaText: renderSchema(tables),
    });

    const execution = await executeReadOnly(generated.sql);

    // Gold SQL failing is infrastructure — every gold query was validated
    // against this database. Throwing voids the question instead of letting a
    // broken environment read as a wrong model answer.
    const gold = await executeReadOnly(record.sql);
    if (!gold.ok) {
      throw new Error(`gold SQL for ${record.id} failed: ${gold.errorCode ?? 'no code'} — ${gold.errorMessage}`);
    }

    const correct = execution.ok && compareRows(execution.rows, gold.rows);

    return {
      correct,
      generatedSql: generated.sql,
      attempts: 1,
      lastPgError: execution.ok ? null : `${execution.errorCode ?? 'no code'} — ${execution.errorMessage}`,
      rowsReturned: execution.ok ? execution.rows.length : null,
      goldRowCount: gold.rows.length,
      columnCountMatch: execution.ok ? (execution.rows[0]?.length ?? 0) === (gold.rows[0]?.length ?? 0) : null,
      tablesSent: tables.map((table) => table.name),
      recallHit: null,
      tokensIn: generated.usage.inputTokens,
      tokensOut: generated.usage.outputTokens,
      thinkingTokens: generated.usage.thinkingTokens,
      usd: usdCost(generated.usage),
      modelMs: generated.ms,
      executionMs: execution.ms,
      mode: MODE,
      picker: 'none',
      repair: 'off',
      promptVersion: generated.promptVersion,
      model: MODEL,
      effort: EFFORT,
    };
  },

  scorers: [
    {
      name: 'same-rows',
      scorer: ({ output }) => (output.correct ? 1 : 0),
    },
  ],

  columns: ({ input, output }) => [
    { label: 'id', value: `${input.id} (${input.difficulty})` },
    { label: 'sql', value: output.generatedSql },
    { label: 'pg error', value: output.lastPgError ?? '' },
    { label: 'rows', value: `${output.rowsReturned ?? '—'} vs ${output.goldRowCount}` },
    { label: 'tokens', value: `${output.tokensIn} in, ${output.tokensOut} out` },
  ],
  },
);
