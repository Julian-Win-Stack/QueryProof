// Re-grades a finished run under the current comparator. No model calls: the
// generated SQL and the gold SQL are both stored in the export, so re-grading
// is a database pass. The only thing that can move a number here is a change to
// compareRows — which is why this exists rather than a re-run.
//
// Both sides execute through the read-only role, so the two results are
// produced under identical session settings (timezone, statement timeout,
// rowMode) and any difference between them is the SQL.

import { readFileSync } from 'node:fs';

import { compareRows } from '../src/compare-rows.ts';
import { confidenceOf } from '../src/confidence.ts';
import { closeReadOnlyPool, executeReadOnly } from '../src/execute-readonly.ts';

type Eval = {
  input: { id: string; sql: string; difficulty: string };
  output: { correct: boolean; generatedSql: string | null; attempts: number; rowsReturned: number };
};

const CONCURRENCY = 10;

async function scoreOne(record: Eval): Promise<'correct' | 'wrong' | 'void'> {
  if (record.output.generatedSql === null) return 'void';

  const [generated, gold] = await Promise.all([
    executeReadOnly(record.output.generatedSql),
    executeReadOnly(record.input.sql),
  ]);

  if (!gold.ok) {
    throw new Error(`gold SQL for ${record.input.id} no longer executes: ${gold.errorMessage}`);
  }
  if (!generated.ok) return 'wrong';

  return compareRows(generated.rows, gold.rows) ? 'correct' : 'wrong';
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error('usage: npm run rescore -- runs/<file>.json');

  const run: { suites: { name: string; evals: Eval[] }[] } = JSON.parse(readFileSync(file, 'utf8'));

  for (const suite of run.suites) {
    const scored: { record: Eval; verdict: 'correct' | 'wrong' | 'void' }[] = [];

    for (let start = 0; start < suite.evals.length; start += CONCURRENCY) {
      const batch = suite.evals.slice(start, start + CONCURRENCY);
      const verdicts = await Promise.all(batch.map(scoreOne));
      batch.forEach((record, index) => scored.push({ record, verdict: verdicts[index] }));
    }

    const denominator = scored.filter((s) => s.verdict !== 'void').length;
    const correct = scored.filter((s) => s.verdict === 'correct').length;
    const wasCorrect = scored.filter((s) => s.record.output.correct).length;
    const gained = scored.filter((s) => s.verdict === 'correct' && !s.record.output.correct);
    const lost = scored.filter((s) => s.verdict !== 'correct' && s.record.output.correct);

    console.log(`\n${suite.name}`);
    console.log(`  as run:    ${wasCorrect}/${denominator}  ${pct(wasCorrect, denominator)}`);
    console.log(`  re-scored: ${correct}/${denominator}  ${pct(correct, denominator)}`);
    console.log(`  gained ${gained.length}, lost ${lost.length}, voids ${scored.length - denominator}`);

    const byDifficulty = new Map<string, { correct: number; total: number }>();
    for (const { record, verdict } of scored) {
      if (verdict === 'void') continue;
      const bucket = byDifficulty.get(record.input.difficulty) ?? { correct: 0, total: 0 };
      bucket.total += 1;
      if (verdict === 'correct') bucket.correct += 1;
      byDifficulty.set(record.input.difficulty, bucket);
    }
    for (const [difficulty, bucket] of byDifficulty) {
      console.log(`    ${difficulty.padEnd(12)} ${bucket.correct}/${bucket.total}  ${pct(bucket.correct, bucket.total)}`);
    }

    if (lost.length > 0) {
      console.log(`  lost: ${lost.map((s) => s.record.input.id).join(' ')}`);
    }

    // A trialCount run repeats every id, so the noise band has to be re-derived
    // under the new comparator too — a band measured under the old one is not
    // the band these numbers are read against. Trial number is the nth
    // occurrence of an id, in export order; evalite records no trial index.
    const perTrial: { correct: number; total: number }[] = [];
    const occurrences = new Map<string, number>();
    for (const { record, verdict } of scored) {
      if (verdict === 'void') continue;
      const trial = occurrences.get(record.input.id) ?? 0;
      occurrences.set(record.input.id, trial + 1);
      perTrial[trial] ??= { correct: 0, total: 0 };
      perTrial[trial].total += 1;
      if (verdict === 'correct') perTrial[trial].correct += 1;
    }

    // The demo's low-confidence flag is a published claim about how often a
    // flagged answer is right, so it moves with the comparator too.
    const flagged = scored.filter((s) => s.verdict !== 'void' && confidenceOf(s.record.output) === 'low');
    const rest = scored.filter((s) => s.verdict !== 'void' && confidenceOf(s.record.output) === 'normal');
    if (flagged.length > 0) {
      const rate = (group: typeof scored) =>
        pct(group.filter((s) => s.verdict === 'correct').length, group.length);
      console.log(`  confidence: flagged ${flagged.length} -> ${rate(flagged)} correct, rest ${rest.length} -> ${rate(rest)}`);
    }

    if (perTrial.length > 1) {
      const rates = perTrial.map((t) => (t.correct / t.total) * 100);
      const band = (Math.max(...rates) - Math.min(...rates)) / 2;
      console.log(`  per trial: ${rates.map((r) => `${r.toFixed(1)}%`).join(' / ')}`);
      console.log(`  noise band: ±${band.toFixed(1)} points over ${rates.length} trials`);
    }
  }

  await closeReadOnlyPool();
}

function pct(part: number, whole: number): string {
  return `${((part / whole) * 100).toFixed(1)}%`;
}

await main();
