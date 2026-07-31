// Phase 6a's exit test: the extractor runs across all 500 gold queries against
// the live 75-table catalog without throwing. Recall is meaningless until this
// has passed — every unknown name and every empty result throws in there.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { loadSchema, tablesForDbId } from './schema.ts';
import { extractGoldTables } from './table-recall.ts';

const GOLD_PATH = new URL('../gold/validated.json', import.meta.url);

type GoldRecord = { id: string; db_id: string; sql: string };

test('every gold query yields at least one catalog table', async () => {
  const catalogNames = new Set((await loadSchema()).map((table) => table.name));
  const gold = JSON.parse(readFileSync(GOLD_PATH, 'utf8')) as GoldRecord[];
  assert.equal(gold.length > 0, true, 'gold/validated.json is empty — run npm run validate-gold');

  for (const record of gold) {
    let tables: string[];
    try {
      tables = extractGoldTables(record.sql, catalogNames);
    } catch (err: unknown) {
      throw new Error(`${record.id}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    assert.equal(tables.length > 0, true, `${record.id} yielded zero tables`);
  }
});

// Cross-check: a BIRD question can only touch its own database's tables, so
// the extracted set must sit inside the record's db_id set. A table from the
// wrong database here means the extractor grabbed something that is not a
// table reference — and it also proves EASY-mode recall is structurally 100%.
test('every extracted table belongs to the gold record\'s own db_id', async () => {
  const catalog = await loadSchema();
  const catalogNames = new Set(catalog.map((table) => table.name));
  const gold = JSON.parse(readFileSync(GOLD_PATH, 'utf8')) as GoldRecord[];

  for (const record of gold) {
    const ownTables = new Set(tablesForDbId(record.db_id, catalog).map((table) => table.name));
    for (const name of extractGoldTables(record.sql, catalogNames)) {
      assert.equal(ownTables.has(name), true, `${record.id} (${record.db_id}) extracted "${name}", which belongs to another database`);
    }
  }
});
