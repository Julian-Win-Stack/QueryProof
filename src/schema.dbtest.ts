// Needs the Postgres container and a populated data/ and gold/. Named
// .dbtest.ts so `npm test` — which stays pure (D4) — does not discover it.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';

import { loadSchema, renderSchema, tablesForDbId, type Table } from './schema.ts';

let tables: Table[];

before(async () => {
  tables = await loadSchema();
});

function table(name: string): Table {
  const found = tables.find((candidate) => candidate.name === name);
  assert.ok(found, `${name} is not in the loaded schema`);
  return found;
}

test('the schema covers every table in public', () => {
  assert.equal(tables.length, 75);
});

test('misspelled column names survive the load verbatim', () => {
  const names = table('posts').columns.map((column) => column.name);

  // BIRD's own typos. Spell-corrected here, all 34 gold queries touching posts
  // fail against a column that does not exist.
  assert.ok(names.includes('creaiondate'));
  assert.ok(names.includes('lasactivitydate'));
  assert.ok(!names.includes('creationdate'));
});

test('column names carrying spaces and capitals render quoted', () => {
  const rendered = renderSchema([table('examination')]);

  assert.match(rendered, /"Examination Date" /);
  assert.match(rendered, /"aCL IgG" /);
  assert.match(rendered, /"ANA Pattern" /);
});

test('the table named after a reserved word renders quoted', () => {
  assert.match(renderSchema([table('order')]), /^CREATE TABLE "order" \(/);
});

test('foreign keys load, so the model is not left guessing join keys', () => {
  assert.deepEqual(table('account').foreignKeys, [
    { column: 'district_id', refTable: 'district', refColumn: 'district_id' },
  ]);
});

test('dev_tables.json mixed-case names resolve to the tables Postgres has', () => {
  // The file spells these Player_Attributes, Player, League, Country, Team,
  // Team_Attributes, Match — none of which exist in Postgres.
  const names = tablesForDbId('european_football_2', tables).map((selected) => selected.name);

  assert.deepEqual(names, [
    'player_attributes',
    'player',
    'league',
    'country',
    'team',
    'team_attributes',
    'match',
  ]);
});

test('every db_id the gold set uses maps onto tables that exist', () => {
  const gold = JSON.parse(
    readFileSync(new URL('../gold/validated.json', import.meta.url), 'utf8'),
  ) as { db_id: string }[];

  const dbIds = [...new Set(gold.map((record) => record.db_id))];
  assert.equal(dbIds.length, 11);

  // tablesForDbId throws on a name Postgres does not have, so this is where the
  // 17 pre-load spellings would surface.
  for (const dbId of dbIds) {
    assert.ok(tablesForDbId(dbId, tables).length > 0, dbId);
  }
});
