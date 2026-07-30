import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareRows } from './compare-rows.ts';

test('row order does not affect equality', () => {
  assert.ok(compareRows([[1, 'a'], [2, 'b']], [[2, 'b'], [1, 'a']]));
});

test('column order does affect equality', () => {
  assert.ok(!compareRows([[1, 2]], [[2, 1]]));
});

test('an extra column is a real difference', () => {
  assert.ok(!compareRows([[1, 2]], [[1]]));
});

test('column names are never consulted', () => {
  // These came from `COUNT(*) AS cnt` and `COUNT(*) AS total`. The comparator
  // only ever sees positional arrays, so the aliases cannot reach it.
  assert.ok(compareRows([[7]], [[7]]));
});

test('a duplicate row is a real difference', () => {
  // Same length, same distinct values — a set comparison would call these
  // equal. That is the symptom of a wrong join key.
  assert.ok(!compareRows([[1], [1], [2]], [[1], [2], [2]]));
  assert.ok(!compareRows([[1], [1]], [[1]]));
});

test('an empty result is not the same as rows', () => {
  assert.ok(!compareRows([], [[1]]));
});

test('a bigint returned as text is the same value as an integer', () => {
  assert.ok(compareRows([['42']], [[42]]));
  assert.ok(!compareRows([['42']], [[43]]));
});

test('text with leading zeros equals the number it coerces to', () => {
  // D1's accepted cost, pinned so a change to it is deliberate rather than
  // noticed as a shifted accuracy number.
  assert.ok(compareRows([['0007']], [[7]]));
});

test('numbers agreeing to six decimal places are the same value', () => {
  assert.ok(compareRows([[0.1 + 0.2]], [['0.3']]));
  assert.ok(!compareRows([[1]], [[1.00001]]));
});

test('a text rendering of a date is the same value as the date', () => {
  assert.ok(compareRows([[new Date(2020, 0, 15)]], [['2020-01-15']]));
  assert.ok(compareRows([[new Date(2020, 0, 15, 13, 45, 30)]], [['2020-01-15 13:45:30']]));
});

test('a date renders from local components, not UTC', () => {
  // One of these two crosses a day boundary in UTC under any nonzero offset, so
  // a toISOString() rendering fails here on any machine not set to UTC.
  assert.ok(compareRows([[new Date(2020, 0, 15, 1, 0, 0)]], [['2020-01-15 01:00:00']]));
  assert.ok(compareRows([[new Date(2020, 0, 15, 23, 0, 0)]], [['2020-01-15 23:00:00']]));
});

test('null and undefined are the same value', () => {
  assert.ok(compareRows([[null]], [[undefined]]));
  assert.ok(!compareRows([[null]], [['null']]));
  assert.ok(!compareRows([[null]], [['']]));
});
