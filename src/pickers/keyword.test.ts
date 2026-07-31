import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Table } from '../schema.ts';
import { keywordPick, PICKER_TABLE_CAP } from './keyword.ts';

function table(name: string, columnNames: string[]): Table {
  return {
    name,
    columns: columnNames.map((column) => ({ name: column, type: 'text', nullable: true })),
    primaryKey: [],
    foreignKeys: [],
  };
}

// Enough filler tables that the cap and the fill are actually exercised.
const FILLER = Array.from({ length: 12 }, (_, i) => table(`zfiller${i}`, ['zzz']));

test('never returns more than the cap, even when more tables match', () => {
  const catalog = Array.from({ length: 12 }, (_, i) => table(`customers${i}`, ['Currency']));
  assert.equal(keywordPick('How many customers pay in EUR?', catalog).length, PICKER_TABLE_CAP);
});

test('fills to the cap even when few tables match', () => {
  const catalog = [table('customers', ['Currency']), ...FILLER];
  const picked = keywordPick('How many customers pay in EUR?', catalog);
  assert.equal(picked.length, PICKER_TABLE_CAP);
  assert.equal(picked[0].name, 'customers');
});

test('a column-name match counts, not just a table-name match', () => {
  const catalog = [
    table('customers', ['CustomerID', 'Currency']),
    table('yearmonth', ['Consumption']),
    ...FILLER,
  ];
  const picked = keywordPick('What is the total consumption?', catalog);
  assert.equal(picked[0].name, 'yearmonth');
});

test('races outranks race when the question says races, and both are sent', () => {
  const catalog = [
    table('race', ['id', 'race_name']),
    table('races', ['raceId', 'year', 'circuitId']),
    ...FILLER,
  ];
  const picked = keywordPick('How many races were held in 2009?', catalog).map((t) => t.name);
  assert.equal(picked[0], 'races');
  assert.equal(picked.includes('race'), true);
});

test('the pick does not depend on catalog order', () => {
  const catalog = [
    table('drivers', ['driverRef', 'surname']),
    table('results', ['driverId', 'positionOrder']),
    ...FILLER,
  ];
  const question = 'Which driver won the most races?';
  assert.deepEqual(
    keywordPick(question, catalog).map((t) => t.name),
    keywordPick(question, [...catalog].reverse()).map((t) => t.name),
  );
});

test('a multi-word column matches through its parts', () => {
  const catalog = [table('examination', ['Examination Date', 'aCL IgG']), ...FILLER];
  const picked = keywordPick('What was the date of the examination?', catalog);
  assert.equal(picked[0].name, 'examination');
});
