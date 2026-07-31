// Builds evals/dev-slice.json — 100 ids stratified on db_id × difficulty.
//
// Run ONCE. The output is committed and never regenerated: a slice that moves
// makes every earlier run incomparable, silently. If this script is ever run
// again and the file exists, it refuses.
//
// Stratified on db_id × difficulty rather than db_id alone because difficulty
// is the stronger predictor of accuracy and it is not evenly spread across
// databases — a db_id-only slice comes out systematically easier or harder
// than the full 500.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const GOLD_PATH = new URL('../gold/validated.json', import.meta.url);
const SLICE_PATH = new URL('../evals/dev-slice.json', import.meta.url);
const SLICE_SIZE = 100;

type GoldRecord = { id: string; db_id: string; difficulty: string };

function loadGold(): GoldRecord[] {
  const parsed: unknown = JSON.parse(readFileSync(GOLD_PATH, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${GOLD_PATH.pathname} is not a JSON array — run npm run validate-gold`);
  }
  return parsed as GoldRecord[];
}

// Largest-remainder allocation: floor every quota, then hand the leftover
// seats to the cells with the largest fractional parts. Every non-empty cell
// must end up with at least one — verified below, not assumed.
function allocate(cellSizes: Map<string, number>, total: number): Map<string, number> {
  const pool = [...cellSizes.values()].reduce((sum, n) => sum + n, 0);

  const quotas = [...cellSizes.entries()].map(([cell, size]) => {
    const quota = (SLICE_SIZE * size) / pool;
    return { cell, base: Math.floor(quota), remainder: quota - Math.floor(quota) };
  });

  let leftover = total - quotas.reduce((sum, q) => sum + q.base, 0);
  quotas.sort((a, b) => b.remainder - a.remainder);
  for (const quota of quotas) {
    if (leftover === 0) break;
    quota.base += 1;
    leftover -= 1;
  }

  return new Map(quotas.map((quota) => [quota.cell, quota.base]));
}

// Evenly spaced picks from the cell sorted by id, not random ones: adjacent
// BIRD ids are often near-duplicate questions on the same tables, so spacing
// avoids clustering, and determinism means the one-time run is reproducible
// if it is ever audited.
function pickFromCell(records: GoldRecord[], count: number): string[] {
  const sorted = records.map((record) => record.id).sort();
  const picks: string[] = [];
  for (let i = 0; i < count; i++) {
    picks.push(sorted[Math.floor(((i + 0.5) * sorted.length) / count)]);
  }
  return picks;
}

function main(): void {
  if (existsSync(SLICE_PATH)) {
    throw new Error(
      `${SLICE_PATH.pathname} already exists. The slice is frozen — delete it only if you accept that every earlier dev-slice number becomes incomparable.`,
    );
  }

  const gold = loadGold();

  const cells = new Map<string, GoldRecord[]>();
  for (const record of gold) {
    const key = `${record.db_id}|${record.difficulty}`;
    const cell = cells.get(key) ?? [];
    cell.push(record);
    cells.set(key, cell);
  }

  const cellSizes = new Map([...cells.entries()].map(([key, records]) => [key, records.length]));
  const allocation = allocate(cellSizes, SLICE_SIZE);

  for (const [cell, count] of allocation) {
    if (count === 0) throw new Error(`cell ${cell} allocated zero — largest remainder did not cover it`);
  }

  const ids = [...allocation.entries()]
    .flatMap(([cell, count]) => pickFromCell(cells.get(cell) ?? [], count))
    .sort();

  if (ids.length !== SLICE_SIZE) throw new Error(`allocated ${ids.length} ids, expected ${SLICE_SIZE}`);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate ids in the slice');

  writeFileSync(SLICE_PATH, `${JSON.stringify(ids, null, 2)}\n`);

  // Verification table: slice share vs pool share, per axis. Eyeball before
  // committing — the numbers in PLAN.md were computed against a 498 pool.
  const inSlice = new Set(ids);
  const share = (axis: (record: GoldRecord) => string): void => {
    const pool = new Map<string, number>();
    const slice = new Map<string, number>();
    for (const record of gold) {
      pool.set(axis(record), (pool.get(axis(record)) ?? 0) + 1);
      if (inSlice.has(record.id)) slice.set(axis(record), (slice.get(axis(record)) ?? 0) + 1);
    }
    for (const [key, poolCount] of [...pool.entries()].sort((a, b) => b[1] - a[1])) {
      const sliceCount = slice.get(key) ?? 0;
      console.log(
        `  ${key.padEnd(24)} slice ${String(sliceCount).padStart(3)} (${((100 * sliceCount) / SLICE_SIZE).toFixed(0)}%)   pool ${String(poolCount).padStart(3)} (${((100 * poolCount) / gold.length).toFixed(1)}%)`,
      );
    }
  };

  console.log(`wrote ${ids.length} ids to ${SLICE_PATH.pathname}\n`);
  console.log('by db_id:');
  share((record) => record.db_id);
  console.log('\nby difficulty:');
  share((record) => record.difficulty);
}

main();
