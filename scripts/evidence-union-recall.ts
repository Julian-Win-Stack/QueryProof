// The union test, $0: would a deterministic post-picker step have fixed the
// picker-missed-table failures? For each question, scan the BIRD evidence for
// catalog column names (exact whole-word, case-insensitive) and add each
// matched column's owning tables to the picker's stored selection. Union only
// ever adds tables, so per-question recall can rise and never fall.
//
// No model calls: selections are read from stored run exports —
//   picker-v1  runs/2026-08-01-122927-exp-v4-rewrites-full.json  (Batch G)
//   picker-v3  runs/20260801-200012-picker-v3-recall-stage1.json
//   picker-v4  runs/20260801-202519-picker-v4-recall-stage1.json
//
// Guard against junk: a column name owned by more than 4 tables is ignored
// (EXPAND's distinctiveness threshold). Reported twice per config: columns
// only, and columns + table names appearing in the evidence — the latter is
// risky because of near-collisions ("race" the superhero table vs "race
// number" in every Formula 1 hint), so it must earn its keep in the numbers.
//
//   npx tsx --env-file-if-exists=.env scripts/evidence-union-recall.ts

import { readFile } from 'node:fs/promises';
import { bridgeDisconnected, unionEvidenceTables } from '../src/pickers/union.ts';
import { loadSchema, type Table } from '../src/schema.ts';
import { recallHit } from '../src/table-recall.ts';

const TARGET_IDS = [
  'bird-0014', 'bird-0023', 'bird-0039', 'bird-0041', 'bird-0045', 'bird-0057',
  'bird-0058', 'bird-0063', 'bird-0127', 'bird-0206', 'bird-0227', 'bird-0266',
  'bird-0314', 'bird-0356', 'bird-0366', 'bird-0367',
];

type GoldRecord = { id: string; evidence: string };
type StoredPick = { tables: string[]; needed: string[] };

async function main(): Promise<void> {
  const gold = JSON.parse(await readFile('gold/validated.json', 'utf8')) as GoldRecord[];
  const evidenceById = new Map(gold.map((record) => [record.id, record.evidence]));
  const catalog = await loadSchema();

  const baseline = await readBaselineExport('runs/2026-08-01-122927-exp-v4-rewrites-full.json');
  const configs: [string, Map<string, StoredPick>][] = [
    ['picker-v1 (Batch G)', baseline],
    ['picker-v3', await readStageExport('runs/20260801-200012-picker-v3-recall-stage1.json', baseline)],
    ['picker-v4', await readStageExport('runs/20260801-202519-picker-v4-recall-stage1.json', baseline)],
  ];

  const tablesByName = new Map(catalog.map((table) => [table.name, table]));

  for (const [label, picks] of configs) {
    const rows = [...picks.entries()].map(([id, pick]) => {
      const evidence = evidenceById.get(id) ?? '';
      const pickedTables = pick.tables
        .map((name) => tablesByName.get(name))
        .filter((table): table is Table => table !== undefined);
      const union = bridgeDisconnected(
        unionEvidenceTables(pickedTables, evidence, catalog),
        catalog,
      ).map((table) => table.name);
      return { id, pick, union };
    });

    const before = rows.filter((row) => recallHit(row.pick.needed, row.pick.tables)).length;
    const after = rows.filter((row) => recallHit(row.pick.needed, row.union)).length;
    const avgBefore = rows.reduce((sum, row) => sum + row.pick.tables.length, 0) / rows.length;
    const avgAfter = rows.reduce((sum, row) => sum + row.union.length, 0) / rows.length;
    const targetsAfter = TARGET_IDS.filter((id) => {
      const row = rows.find((candidate) => candidate.id === id);
      return row !== undefined && recallHit(row.pick.needed, row.union);
    });

    console.log(`${label}  [evidence union + fk bridge]`);
    console.log(`  recall ${pct(before, rows.length)} -> ${pct(after, rows.length)}`);
    console.log(`  avg tables ${avgBefore.toFixed(2)} -> ${avgAfter.toFixed(2)}`);
    console.log(`  targets hit after union: ${targetsAfter.length}/${TARGET_IDS.length} — missing: ${TARGET_IDS.filter((id) => !targetsAfter.includes(id)).join(', ') || 'none'}`);
    console.log('');
  }
}

async function readBaselineExport(path: string): Promise<Map<string, StoredPick>> {
  const run = JSON.parse(await readFile(path, 'utf8')) as {
    suites: { evals: { input: { id: string }; output: { tablesSent: string[]; tablesGoldNeeded: string[] } }[] }[];
  };
  const picks = new Map<string, StoredPick>();
  for (const suite of run.suites) {
    for (const row of suite.evals) {
      picks.set(row.input.id, { tables: row.output.tablesSent, needed: row.output.tablesGoldNeeded });
    }
  }
  return picks;
}

async function readStageExport(
  path: string,
  baseline: Map<string, StoredPick>,
): Promise<Map<string, StoredPick>> {
  const stage = JSON.parse(await readFile(path, 'utf8')) as {
    results: { id: string; tables: string[]; error?: string }[];
  };
  const picks = new Map<string, StoredPick>();
  for (const row of stage.results) {
    if (row.error !== undefined) continue;
    const needed = baseline.get(row.id)?.needed;
    if (needed === undefined) throw new Error(`${row.id} missing from baseline export`);
    picks.set(row.id, { tables: row.tables, needed });
  }
  return picks;
}

function pct(numerator: number, denominator: number): string {
  return `${((numerator / denominator) * 100).toFixed(1)}% (${numerator}/${denominator})`;
}

await main();
