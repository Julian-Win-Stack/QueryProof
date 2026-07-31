// Phase 5d — count failures, do not read them.
//
//   npm run triage -- runs/2026-07-30-153025-easy-full.json
//
// Every failure lands in exactly one bucket, and the buckets say where the next
// day of work goes. "Comparator suspect" exists because a semantically right
// query failing on a canonicalization gap has no error message anywhere — it
// otherwise hides inside "valid but wrong" and a day goes to tuning SQL prompts
// against a grader bug.

import { readFileSync } from 'node:fs';

type ExportedEval = {
  status: string;
  input: { id: string };
  output: {
    lastPgError: string | null;
    rowsReturned: number | null;
    goldRowCount: number;
    columnCountMatch: boolean | null;
    recallHit: boolean | null;
  } | null;
  scores: { name: string; score: number }[];
};

type Suite = { name: string; evals: ExportedEval[] };
type RunExport = { suites: Suite[] };

const path = process.argv[2];
if (!path) throw new Error('usage: triage.ts <runs/....json>');

const parsed = JSON.parse(readFileSync(path, 'utf8')) as RunExport;
if (parsed.suites.length === 0) throw new Error(`${path} holds no suites`);

// A bake-off export carries one suite per picker variant — triage each on its
// own; merging them would blame one picker's failures on both.
for (const suite of parsed.suites) triageSuite(suite);

type Bucket = 'table missing' | 'never valid' | 'comparator suspect' | 'valid but wrong';

function bucketOf(e: ExportedEval): Bucket {
  const out = e.output;
  if (!out) throw new Error(`${e.input.id} scored but has no output`);
  if (out.recallHit === false) return 'table missing';
  if (out.lastPgError !== null) return 'never valid';
  if (out.rowsReturned === out.goldRowCount && out.columnCountMatch) return 'comparator suspect';
  return 'valid but wrong';
}

// Correctness is the same-rows scorer, looked up by name — since table-recall
// joined it, position in the scores array is not a contract.
function sameRowsScore(e: ExportedEval): number | undefined {
  return e.scores.find((score) => score.name === 'same-rows')?.score;
}

function triageSuite(suite: Suite): void {
  const evals = suite.evals;
  // Voids are not failures: the question never reached a scorable answer
  // (429 out of retries, refusal, gold SQL breaking). Reported next to the
  // accuracy figure, and a non-zero count voids the run (D12b, D19).
  const voids = evals.filter((e) => e.status !== 'success');
  const scored = evals.filter((e) => e.status === 'success');
  const failures = scored.filter((e) => sameRowsScore(e) !== 1);

  const counts = new Map<Bucket, number>();
  const examples = new Map<Bucket, string[]>();
  for (const failure of failures) {
    const bucket = bucketOf(failure);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    const ids = examples.get(bucket) ?? [];
    if (ids.length < 5) ids.push(failure.input.id);
    examples.set(bucket, ids);
  }

  const order: [Bucket, string][] = [
    ['table missing', 'table selection'],
    ['never valid', 'prompt / schema text'],
    ['comparator suspect', 'THE ROW COMPARATOR — read these first'],
    ['valid but wrong', 'SQL logic'],
  ];

  console.log(suite.name);
  console.log(`scored ${scored.length}, correct ${scored.length - failures.length}, failures ${failures.length}, voids ${voids.length}\n`);
  console.log('bucket              count  fix lives in                            e.g.');
  for (const [bucket, fix] of order) {
    const count = counts.get(bucket) ?? 0;
    console.log(
      `${bucket.padEnd(19)} ${String(count).padStart(4)}  ${fix.padEnd(39)} ${(examples.get(bucket) ?? []).join(' ')}`,
    );
  }

  const sum = [...counts.values()].reduce((total, count) => total + count, 0);
  if (sum !== failures.length) {
    throw new Error(`buckets sum to ${sum} but there are ${failures.length} failures — a failure escaped the buckets`);
  }
  if (voids.length > 0) {
    console.log(`\n⚠ ${voids.length} void(s): ${voids.map((v) => v.input.id).join(' ')} — this run's verdict is void (D12b/D19)`);
  }
  console.log('');
}
