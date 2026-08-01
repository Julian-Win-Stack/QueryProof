// Measures the dialect rewrites (src/rewrites.ts) against a finished run
// without a single model call: the stored generated SQL is re-executed as-is
// and under each rewrite, both compared to gold. Because the SQL is identical
// on both sides of the comparison, the flip counts are exact — no noise band
// applies. This is the evidence the REWRITE axis ships on.
//
//   npm run replay -- runs/<file>.json
//
// Three variants beyond the baseline: nulls-last alone, text-cast alone, both.
// text-cast chases errors the way answer.ts does — each cast can surface the
// next date-LIKE error in the same query.

import { readFileSync } from 'node:fs';

import { compareRows } from '../src/compare-rows.ts';
import {
  closeReadOnlyPool,
  executeReadOnly,
  type ExecutionResult,
} from '../src/execute-readonly.ts';
import { applyNullsLast, applyTextCast } from '../src/rewrites.ts';

type Eval = {
  input: { id: string; sql: string };
  output: { correct: boolean; generatedSql: string | null };
};

const CONCURRENCY = 10;
const MAX_TEXT_CASTS = 5;
const VARIANTS = ['baseline', 'nulls-last', 'text-cast', 'both'] as const;
type Variant = (typeof VARIANTS)[number];

type Replayed = {
  id: string;
  verdicts: Record<Variant, boolean>;
  fired: Record<Variant, boolean>;
};

async function executeWithCasts(sql: string): Promise<{ result: ExecutionResult; cast: boolean }> {
  let current = sql;
  let result = await executeReadOnly(current);
  let cast = false;
  for (let i = 0; i < MAX_TEXT_CASTS; i++) {
    const next = applyTextCast(current, result);
    if (next === null) break;
    current = next;
    result = await executeReadOnly(current);
    cast = true;
  }
  return { result, cast };
}

async function replayOne(record: Eval): Promise<Replayed | null> {
  const sql = record.output.generatedSql;
  if (sql === null) return null;

  const gold = await executeReadOnly(record.input.sql);
  if (!gold.ok) {
    throw new Error(`gold SQL for ${record.input.id} no longer executes: ${gold.errorMessage}`);
  }

  const nullsLastSql = applyNullsLast(sql);
  const nullsChanged = nullsLastSql !== sql;

  const base = await executeReadOnly(sql);
  const withCasts = await executeWithCasts(sql);
  // Reuse the baseline execution when nulls-last rewrote nothing — the SQL is
  // byte-identical, so a second execution could only add noise.
  const nulls = nullsChanged ? await executeReadOnly(nullsLastSql) : base;
  const both = nullsChanged ? await executeWithCasts(nullsLastSql) : withCasts;

  const correct = (execution: ExecutionResult): boolean =>
    execution.ok && compareRows(execution.rows, gold.rows);

  return {
    id: record.input.id,
    verdicts: {
      baseline: correct(base),
      'nulls-last': correct(nulls),
      'text-cast': correct(withCasts.result),
      both: correct(both.result),
    },
    fired: {
      baseline: false,
      'nulls-last': nullsChanged,
      'text-cast': withCasts.cast,
      both: nullsChanged || both.cast,
    },
  };
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error('usage: npm run replay -- runs/<file>.json');

  const run: { suites: { name: string; evals: Eval[] }[] } = JSON.parse(readFileSync(file, 'utf8'));

  for (const suite of run.suites) {
    const replayed: Replayed[] = [];
    for (let start = 0; start < suite.evals.length; start += CONCURRENCY) {
      const batch = suite.evals.slice(start, start + CONCURRENCY);
      const results = await Promise.all(batch.map(replayOne));
      for (const result of results) if (result !== null) replayed.push(result);
    }

    const total = replayed.length;
    console.log(`\n${suite.name}`);
    console.log(`  ${total} replayed (${suite.evals.length - total} void)`);

    for (const variant of VARIANTS) {
      const correct = replayed.filter((r) => r.verdicts[variant]).length;
      if (variant === 'baseline') {
        console.log(`  baseline:    ${correct}/${total}  ${pct(correct, total)}`);
        continue;
      }
      const fired = replayed.filter((r) => r.fired[variant]);
      const gained = replayed.filter((r) => r.verdicts[variant] && !r.verdicts.baseline);
      const lost = replayed.filter((r) => !r.verdicts[variant] && r.verdicts.baseline);
      console.log(
        `  ${variant.padEnd(12)} ${correct}/${total}  ${pct(correct, total)}  fired on ${fired.length}, gained ${gained.length}, lost ${lost.length}`,
      );
      if (gained.length > 0) console.log(`    gained: ${gained.map((r) => r.id).join(' ')}`);
      if (lost.length > 0) console.log(`    lost:   ${lost.map((r) => r.id).join(' ')}`);
    }
  }

  await closeReadOnlyPool();
}

function pct(part: number, whole: number): string {
  return `${((part / whole) * 100).toFixed(1)}%`;
}

await main();
