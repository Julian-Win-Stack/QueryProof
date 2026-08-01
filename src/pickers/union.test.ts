import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Table } from '../schema.ts';
import { bridgeDisconnected, unionEvidenceTables } from './union.ts';

function table(name: string, columns: string[], refs: string[] = []): Table {
  return {
    name,
    columns: columns.map((column) => ({ name: column, type: 'text', nullable: true })),
    primaryKey: [],
    foreignKeys: refs.map((refTable) => ({ column: `${refTable}_id`, refTable, refColumn: 'id' })),
  };
}

// The student_club shape behind bird-0057/0063: expense -> budget -> event.
const event = table('event', ['event_id', 'event_name', 'status']);
const budget = table('budget', ['budget_id', 'category', 'event_status'], ['event']);
const expense = table('expense', ['expense_id', 'cost', 'expense_description'], ['budget']);
const catalog = [event, budget, expense];

test('a distinctive column named in the evidence pulls in its owning table', () => {
  const result = unionEvidenceTables([event], "lowest cost means MIN(cost)", catalog);
  assert.deepEqual(result.map((t) => t.name), ['event', 'expense']);
});

test('a column written with spaces matches its underscored name (bird-0063)', () => {
  const result = unionEvidenceTables([event], "'Posters' is the expense description", catalog);
  assert.ok(result.map((t) => t.name).includes('expense'));
});

test('a column name inside a longer word does not match', () => {
  const result = unionEvidenceTables([event], 'the lowestcost of anything', catalog);
  assert.deepEqual(result.map((t) => t.name), ['event']);
});

test('a table name in the evidence pulls the table in', () => {
  const result = unionEvidenceTables([event], 'values live in the budget table', catalog);
  assert.ok(result.map((t) => t.name).includes('budget'));
});

test('a column owned by more than four tables is ignored', () => {
  const wide = ['a', 'b', 'c', 'd', 'e'].map((name) => table(name, ['id', 'name']));
  const result = unionEvidenceTables([wide[0]], 'filter on name', wide);
  assert.deepEqual(result.map((t) => t.name), ['a']);
});

test('empty evidence changes nothing', () => {
  assert.deepEqual(unionEvidenceTables([event], '  ', catalog), [event]);
});

test('a matched table already picked is not added twice', () => {
  const result = unionEvidenceTables([expense], 'lowest cost means MIN(cost)', catalog);
  assert.deepEqual(result.map((t) => t.name), ['expense']);
});

test('bridge adds the middle table two picked tables both link to (bird-0057)', () => {
  const result = bridgeDisconnected([event, expense], catalog);
  assert.deepEqual(result.map((t) => t.name), ['event', 'expense', 'budget']);
});

test('bridge leaves an already-connected pick alone', () => {
  const result = bridgeDisconnected([budget, expense], catalog);
  assert.deepEqual(result.map((t) => t.name), ['budget', 'expense']);
});
