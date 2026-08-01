// Two deterministic post-picker steps (UNION=on), built from the cluster-1
// failure analysis in docs/winnable-failures.md and pre-measured for $0
// against stored selections before any run spent money:
//
//   unionEvidenceTables — the BIRD evidence names columns ("cost", "KCT",
//   "DisplayName") and sometimes tables ("the yearmonth table"). The LLM
//   picker does not do the column->owner lookup even when told to (picker-v3
//   and picker-v4, RUNS.md 2026-08-01), so code does it: any catalog column
//   or table name appearing whole-word in the evidence pulls its table into
//   the selection. Additions only — recall can rise, never fall.
//
//   bridgeDisconnected — a join's middle table is named nowhere (bird-0057:
//   event and expense only connect through budget). When the picked tables do
//   not connect through the foreign-key graph, add any table directly linked
//   to two of the disconnected groups. Fires only on a broken join path.

import type { Table } from '../schema.ts';

// A column name owned by more than this many tables ("id", "date", "name",
// "text") says nothing about which table is meant — matching it would drag in
// junk on most questions.
const MAX_OWNERS = 4;

export function unionEvidenceTables(
  picked: Table[],
  evidence: string,
  catalog: Table[],
): Table[] {
  if (evidence.trim() === '') return picked;

  const result = [...picked];
  const have = new Set(picked.map((table) => table.name));
  const add = (table: Table): void => {
    if (!have.has(table.name)) {
      have.add(table.name);
      result.push(table);
    }
  };

  const owners = columnOwners(catalog);
  for (const [column, tables] of owners) {
    if (matchesWholeWord(evidence, column)) for (const table of tables) add(table);
  }
  for (const table of catalog) {
    if (matchesWholeWord(evidence, table.name)) add(table);
  }
  return result;
}

export function bridgeDisconnected(picked: Table[], catalog: Table[]): Table[] {
  if (picked.length < 2) return picked;

  const adjacency = fkAdjacency(catalog);
  const componentOf = connectedComponents(picked, adjacency);
  if (new Set(componentOf.values()).size < 2) return picked;

  const result = [...picked];
  const have = new Set(picked.map((table) => table.name));
  for (const table of catalog) {
    if (have.has(table.name)) continue;
    const touched = new Set<number>();
    for (const neighbor of adjacency.get(table.name) ?? []) {
      const component = componentOf.get(neighbor);
      if (component !== undefined) touched.add(component);
    }
    if (touched.size >= 2) {
      have.add(table.name);
      result.push(table);
    }
  }
  return result;
}

function columnOwners(catalog: Table[]): Map<string, Table[]> {
  const owners = new Map<string, Table[]>();
  for (const table of catalog) {
    for (const column of table.columns) {
      const key = column.name.toLowerCase();
      owners.set(key, [...(owners.get(key) ?? []), table]);
    }
  }
  return new Map([...owners].filter(([, tables]) => tables.length <= MAX_OWNERS));
}

// The evidence writes column names both ways: "date_received" but also
// "expense description" for expense_description (bird-0063). Match the name
// as stored and with underscores read as spaces.
function matchesWholeWord(text: string, name: string): boolean {
  const variants = new Set([name, name.replaceAll('_', ' ')]);
  for (const variant of variants) {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`, 'i').test(text)) return true;
  }
  return false;
}

function fkAdjacency(catalog: Table[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    adjacency.set(a, (adjacency.get(a) ?? new Set()).add(b));
    adjacency.set(b, (adjacency.get(b) ?? new Set()).add(a));
  };
  for (const table of catalog) {
    for (const foreignKey of table.foreignKeys) link(table.name, foreignKey.refTable);
  }
  return adjacency;
}

// Component id per picked table, connected through edges between picked
// tables only — an unpicked table joining two picked ones is exactly what
// this must NOT see, or there would be nothing to bridge.
function connectedComponents(
  picked: Table[],
  adjacency: Map<string, Set<string>>,
): Map<string, number> {
  const pickedNames = new Set(picked.map((table) => table.name));
  const componentOf = new Map<string, number>();
  let nextComponent = 0;
  for (const table of picked) {
    if (componentOf.has(table.name)) continue;
    const queue = [table.name];
    componentOf.set(table.name, nextComponent);
    while (queue.length > 0) {
      const current = queue.pop() as string;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (pickedNames.has(neighbor) && !componentOf.has(neighbor)) {
          componentOf.set(neighbor, nextComponent);
          queue.push(neighbor);
        }
      }
    }
    nextComponent += 1;
  }
  return componentOf;
}
