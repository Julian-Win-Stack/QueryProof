import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractGoldTables, recallHit } from './table-recall.ts';

const CATALOG = new Set(['races', 'race', 'drivers', 'results', 'order', 'patient', 'examination']);

test('finds tables after FROM and JOIN, folding unquoted names to lowercase', () => {
  const tables = extractGoldTables(
    'SELECT * FROM Races AS T1 INNER JOIN Drivers AS T2 ON T1.driverId = T2.driverId',
    CATALOG,
  );
  assert.deepEqual(tables.sort(), ['drivers', 'races']);
});

test('a quoted identifier is taken exactly as written', () => {
  assert.deepEqual(extractGoldTables('SELECT * FROM "order"', CATALOG), ['order']);
});

test('an alias is not a table', () => {
  const tables = extractGoldTables('SELECT T1.name FROM drivers T1', CATALOG);
  assert.deepEqual(tables, ['drivers']);
});

test('a CTE name is not a table, but the tables inside the CTE are', () => {
  const tables = extractGoldTables(
    'WITH fastest AS (SELECT raceId FROM results) SELECT * FROM fastest JOIN races ON races.raceId = fastest.raceId',
    CATALOG,
  );
  assert.deepEqual(tables.sort(), ['races', 'results']);
});

test('a subquery in FROM contributes its inner tables', () => {
  const tables = extractGoldTables(
    'SELECT * FROM (SELECT driverId FROM results WHERE positionOrder = 1) AS winners',
    CATALOG,
  );
  assert.deepEqual(tables, ['results']);
});

test('from inside a string literal is not a table reference', () => {
  const tables = extractGoldTables(
    "SELECT * FROM races WHERE name = 'from join order'",
    CATALOG,
  );
  assert.deepEqual(tables, ['races']);
});

test('FROM inside EXTRACT is function syntax, not a table reference', () => {
  const tables = extractGoldTables(
    'SELECT EXTRACT(YEAR FROM T1.Birthday) FROM patient AS T1 JOIN examination ON patient.ID = examination.ID',
    CATALOG,
  );
  assert.deepEqual(tables.sort(), ['examination', 'patient']);
});

test('a name that is not in the catalog throws instead of passing through', () => {
  assert.throws(
    () => extractGoldTables('SELECT * FROM customres', CATALOG),
    /not in the catalog/,
  );
});

test('a query with a FROM that yields no tables throws instead of scoring a hit', () => {
  // FROM ( opens a subquery, and the inner SELECT has no FROM at all — the
  // vacuous-hit shape the guard exists for.
  assert.throws(() => extractGoldTables('SELECT * FROM (SELECT 1) AS x', CATALOG), /found no tables/);
});

test('recall hit means every needed table was sent, extras do not matter', () => {
  assert.equal(recallHit(['races', 'drivers'], ['races', 'drivers', 'results']), true);
});

test('one missing table is a miss — there is no partial credit', () => {
  assert.equal(recallHit(['races', 'drivers'], ['races', 'results', 'order']), false);
});
