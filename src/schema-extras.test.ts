// The pure pieces only: the CSV parser the description loader depends on, and
// cell formatting. The database-reading loaders are exercised by the eval's
// wiring smoke, not mocked here.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatCell, parseCsv } from './schema-extras.ts';

test('parseCsv handles quoted fields with commas, doubled quotes and newlines', () => {
  const text = 'a,b\n"one, two","he said ""hi""\nnext line"\nplain,last';
  assert.deepEqual(parseCsv(text), [
    ['a', 'b'],
    ['one, two', 'he said "hi"\nnext line'],
    ['plain', 'last'],
  ]);
});

test('parseCsv strips the BOM the BIRD files open with', () => {
  assert.deepEqual(parseCsv('﻿a,b\n1,2'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('parseCsv drops blank lines instead of returning empty records', () => {
  assert.deepEqual(parseCsv('a,b\n\n1,2\n'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('formatCell quotes text, passes numbers through, and truncates long values', () => {
  assert.equal(formatCell(null), 'NULL');
  assert.equal(formatCell('42'), '42');
  assert.equal(formatCell('-3.5'), '-3.5');
  assert.equal(formatCell("O'Brien"), "'O''Brien'");
  const long = 'x'.repeat(60);
  assert.equal(formatCell(long), `'${'x'.repeat(40)}…'`);
});
