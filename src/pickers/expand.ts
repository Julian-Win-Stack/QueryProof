// Join-partner expansion — the EXPAND=on experiment. After the picker chooses,
// add every table that shares a distinctive column name with a chosen one. The
// dump carries almost no cross-database foreign keys, so a shared column name
// is the only join signal available.
//
// Measured offline on the stored hard-llm run before this was wired in: the
// picker's 86.0% recall rises to 94.8% at 5.6 tables average. Whether that
// buys accuracy is what the eval run answers.

import type { Table } from '../schema.ts';

// A column name shared by half the catalog ("id", "name") is a coincidence,
// not a join signal. 4 matches the offline measurement above.
const MAX_TABLES_PER_COLUMN = 4;

export function expandWithJoinPartners(picked: Table[], catalog: Table[]): Table[] {
  const tablesWithColumn = new Map<string, Table[]>();
  for (const table of catalog) {
    for (const column of table.columns) {
      const key = column.name.toLowerCase();
      const list = tablesWithColumn.get(key) ?? [];
      list.push(table);
      tablesWithColumn.set(key, list);
    }
  }

  const expanded = [...picked];
  for (const table of picked) {
    for (const column of table.columns) {
      const sharers = tablesWithColumn.get(column.name.toLowerCase()) ?? [];
      if (sharers.length > MAX_TABLES_PER_COLUMN) continue;
      for (const sharer of sharers) {
        if (!expanded.includes(sharer)) expanded.push(sharer);
      }
    }
  }
  return expanded;
}
