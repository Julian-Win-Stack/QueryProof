// What did a change break? Accuracy answers whether a run won; this answers
// which questions moved, which is where the diagnosis lives. No model calls —
// both runs stored their generated SQL, so this is a database pass.
//
// Two things make the answer trustworthy.
//
// Both sides are re-graded here rather than read from their stored verdicts.
// The comparator changes over time (it changed on 2026-07-31), and a stored
// verdict was produced by whatever version was current that day. Comparing
// yesterday's verdict to today's measures the grader as well as the change.
//
// A regression must fail in *every* trial. The model has no determinism knob
// and answers ~9% of questions differently across identical runs, so a single
// right-to-wrong flip is usually the dice. Questions that disagree with
// themselves are reported as unsettled, never as evidence either way.

import { readFileSync } from 'node:fs';

import { compareRows } from '../src/compare-rows.ts';
import { closeReadOnlyPool, executeReadOnly } from '../src/execute-readonly.ts';

type Eval = {
  input: { id: string; sql: string; difficulty: string; question: string };
  output: { generatedSql: string | null };
};

type Verdict = 'correct' | 'wrong' | 'void';

type Question = { record: Eval; verdicts: Verdict[] };

const CONCURRENCY = 10;

async function grade(record: Eval): Promise<Verdict> {
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

// A trialCount run repeats every id, so one question owns several verdicts.
async function gradeRun(file: string): Promise<{ name: string; byId: Map<string, Question> }> {
  const run: { suites: { name: string; evals: Eval[] }[] } = JSON.parse(readFileSync(file, 'utf8'));
  if (run.suites.length !== 1) {
    throw new Error(`${file} holds ${run.suites.length} suites; diff compares one configuration`);
  }

  const { name, evals } = run.suites[0];
  const byId = new Map<string, Question>();

  for (let start = 0; start < evals.length; start += CONCURRENCY) {
    const batch = evals.slice(start, start + CONCURRENCY);
    const verdicts = await Promise.all(batch.map(grade));
    batch.forEach((record, index) => {
      const question = byId.get(record.input.id) ?? { record, verdicts: [] };
      question.verdicts.push(verdicts[index]);
      byId.set(record.input.id, question);
    });
  }

  return { name, byId };
}

// 'mixed' is the model disagreeing with itself across identical trials. It is
// not a weaker form of right or wrong — it is the absence of a verdict.
function settle(verdicts: Verdict[]): 'right' | 'wrong' | 'mixed' | 'void' {
  if (verdicts.includes('void')) return 'void';
  if (verdicts.every((verdict) => verdict === 'correct')) return 'right';
  if (verdicts.every((verdict) => verdict === 'wrong')) return 'wrong';
  return 'mixed';
}

async function main(): Promise<void> {
  const [beforeFile, afterFile] = process.argv.slice(2);
  if (!beforeFile || !afterFile) {
    throw new Error('usage: npm run diff -- runs/<before>.json runs/<after>.json');
  }

  const before = await gradeRun(beforeFile);
  const after = await gradeRun(afterFile);

  const regressions: string[] = [];
  const gains: string[] = [];
  let unchanged = 0;
  let unsettled = 0;
  let voided = 0;

  // Runs of different sizes diff over what they share — a dev-slice run against
  // the full run that contains it is the common case.
  const shared = [...before.byId.keys()].filter((id) => after.byId.has(id));

  for (const id of shared) {
    const wasCorrect = settle(before.byId.get(id)!.verdicts);
    const nowCorrect = settle(after.byId.get(id)!.verdicts);

    if (wasCorrect === 'void' || nowCorrect === 'void') voided += 1;
    else if (wasCorrect === 'mixed' || nowCorrect === 'mixed') unsettled += 1;
    else if (wasCorrect === 'right' && nowCorrect === 'wrong') regressions.push(id);
    else if (wasCorrect === 'wrong' && nowCorrect === 'right') gains.push(id);
    else unchanged += 1;
  }

  const trials = (run: { byId: Map<string, Question> }) =>
    [...run.byId.values()][0]?.verdicts.length ?? 0;

  console.log(`\nbefore  ${before.name}  (${trials(before)} trial(s))`);
  console.log(`after   ${after.name}  (${trials(after)} trial(s))`);
  console.log(`\n${shared.length} questions in both runs`);
  console.log(`  got worse:   ${regressions.length}   wrong in every trial after, right in every trial before`);
  console.log(`  got better:  ${gains.length}`);
  console.log(`  unchanged:   ${unchanged}`);
  console.log(`  can't say:   ${unsettled}   the model disagreed with itself across identical trials`);
  if (voided > 0) console.log(`  voided:      ${voided}   no SQL produced; never counted as wrong`);

  for (const id of regressions) {
    const was = before.byId.get(id)!.record;
    const now = after.byId.get(id)!.record;
    console.log(`\n${'='.repeat(78)}\n${id}  (${was.input.difficulty})`);
    console.log(`Q: ${was.input.question}`);
    console.log(`\n-- reference\n${was.input.sql}`);
    console.log(`\n-- before (correct)\n${was.output.generatedSql}`);
    console.log(`\n-- after (wrong)\n${now.output.generatedSql}`);
  }

  if (gains.length > 0) {
    console.log(`\n${'='.repeat(78)}\ngained: ${gains.join(' ')}`);
  }

  await closeReadOnlyPool();
}

await main();
