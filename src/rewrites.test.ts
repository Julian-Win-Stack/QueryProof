import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type ExecutionResult } from './execute-readonly.ts';
import { applyNullsLast, applyTextCast } from './rewrites.ts';

// --- applyNullsLast ---

test('a bare DESC in ORDER BY gets NULLS LAST', () => {
  assert.equal(
    applyNullsLast('SELECT driverid FROM drivers ORDER BY dob DESC LIMIT 1'),
    'SELECT driverid FROM drivers ORDER BY dob DESC NULLS LAST LIMIT 1',
  );
});

test('a DESC already qualified with NULLS is left alone', () => {
  const first = 'SELECT a FROM t ORDER BY a DESC NULLS FIRST';
  assert.equal(applyNullsLast(first), first);
  const last = 'SELECT a FROM t ORDER BY a DESC NULLS LAST';
  assert.equal(applyNullsLast(last), last);
});

test('every DESC is qualified, including inside a window function', () => {
  // bird-0249's shape: the window ORDER BY is the one that scored wrong.
  assert.equal(
    applyNullsLast('SELECT RANK() OVER (ORDER BY height_cm DESC) FROM superhero ORDER BY height_cm DESC'),
    'SELECT RANK() OVER (ORDER BY height_cm DESC NULLS LAST) FROM superhero ORDER BY height_cm DESC NULLS LAST',
  );
});

test('DESC inside string literals and quoted identifiers is never touched', () => {
  const sql = `SELECT "desc" FROM t WHERE note = 'sort desc please' ORDER BY "desc" DESC`;
  assert.equal(
    applyNullsLast(sql),
    `SELECT "desc" FROM t WHERE note = 'sort desc please' ORDER BY "desc" DESC NULLS LAST`,
  );
});

test('identifiers that merely contain desc are never touched', () => {
  const sql = 'SELECT expense_description FROM expense ORDER BY cost ASC';
  assert.equal(applyNullsLast(sql), sql);
});

test('lowercase desc keeps its casing', () => {
  assert.equal(
    applyNullsLast('select a from t order by a desc'),
    'select a from t order by a desc NULLS LAST',
  );
});

// --- applyTextCast ---

function dateLikeError(sql: string, operator: string): ExecutionResult {
  // Postgres's position is 1-based and points at the operator keyword.
  const index = sql.indexOf(operator);
  assert.notEqual(index, -1);
  return {
    ok: false,
    errorCode: '42883',
    errorMessage: 'operator does not exist: date ~~ unknown',
    errorPosition: index + 1,
    ms: 1,
  };
}

test('the column before the failing LIKE gets ::text', () => {
  // bird-0096's shape, quoted qualified column included.
  const sql = `SELECT p."id" FROM "patient" p JOIN "laboratory" l ON p."id" = l."id" WHERE l."date" LIKE '1991-10%'`;
  assert.equal(
    applyTextCast(sql, dateLikeError(sql, 'LIKE')),
    `SELECT p."id" FROM "patient" p JOIN "laboratory" l ON p."id" = l."id" WHERE l."date"::text LIKE '1991-10%'`,
  );
});

test('NOT LIKE casts the column, not the NOT', () => {
  const sql = `SELECT id FROM laboratory WHERE date NOT LIKE '1991-%'`;
  assert.equal(
    applyTextCast(sql, dateLikeError(sql, 'NOT LIKE')),
    `SELECT id FROM laboratory WHERE date::text NOT LIKE '1991-%'`,
  );
});

test('a successful execution is never rewritten', () => {
  const ok: ExecutionResult = { ok: true, rows: [], columns: [], ms: 1 };
  assert.equal(applyTextCast('SELECT 1', ok), null);
});

test('a different 42883 is never rewritten', () => {
  const sql = 'SELECT DIVIDE(1, 2)';
  const error: ExecutionResult = {
    ok: false,
    errorCode: '42883',
    errorMessage: 'function divide(bigint, bigint) does not exist',
    errorPosition: 8,
    ms: 1,
  };
  assert.equal(applyTextCast(sql, error), null);
});

test('a missing position gives up rather than guessing', () => {
  const error: ExecutionResult = {
    ok: false,
    errorCode: '42883',
    errorMessage: 'operator does not exist: date ~~ unknown',
    errorPosition: null,
    ms: 1,
  };
  assert.equal(applyTextCast(`SELECT 1 WHERE d LIKE 'x'`, error), null);
});
