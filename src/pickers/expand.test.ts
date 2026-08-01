import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Table } from '../schema.ts';
import { expandWithJoinPartners } from './expand.ts';

function table(name: string, columnNames: string[]): Table {
  return {
    name,
    columns: columnNames.map((columnName) => ({ name: columnName, type: 'text', nullable: true })),
    primaryKey: [],
    foreignKeys: [],
  };
}

test('adds a table sharing a distinctive column name', () => {
  const races = table('races', ['raceId', 'year']);
  const results = table('results', ['raceId', 'position']);
  const unrelated = table('molecule', ['molecule_id']);

  const expanded = expandWithJoinPartners([races], [races, results, unrelated]);

  assert.deepEqual(
    expanded.map((entry) => entry.name),
    ['races', 'results'],
  );
});

test('a column shared by too many tables is not a join signal', () => {
  const catalog = ['a', 'b', 'c', 'd', 'e'].map((name) => table(name, ['id']));

  const expanded = expandWithJoinPartners([catalog[0]], catalog);

  assert.deepEqual(
    expanded.map((entry) => entry.name),
    ['a'],
  );
});

test('column-name matching ignores case', () => {
  const player = table('player', ['Player_Id']);
  const attributes = table('player_attributes', ['player_id']);

  const expanded = expandWithJoinPartners([player], [player, attributes]);

  assert.deepEqual(
    expanded.map((entry) => entry.name),
    ['player', 'player_attributes'],
  );
});

test('picked tables stay first and are never duplicated', () => {
  const races = table('races', ['raceId']);
  const results = table('results', ['raceId', 'driverId']);
  const drivers = table('drivers', ['driverId']);

  const expanded = expandWithJoinPartners([results, races], [drivers, races, results]);

  assert.deepEqual(
    expanded.map((entry) => entry.name),
    ['results', 'races', 'drivers'],
  );
});
