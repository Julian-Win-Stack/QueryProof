import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as v1 from './v1.ts';
import { buildUserMessage, PROMPT_VERSION } from './v2.ts';

test('a record without evidence gets no hint section', () => {
  // Not every BIRD record carries evidence, and whitespace-only is the case the
  // trim() exists for. An unconditional section would send the model an empty
  // "Hint:" heading and invite it to invent one.
  const message = buildUserMessage({
    question: 'How many customers pay in EUR?',
    evidence: '   ',
    schemaText: 'CREATE TABLE "customers" (\n  "currency" text\n);',
  });

  assert.ok(!message.includes('Hint'));
  // The two below are what stop the assertion above passing on an empty string.
  assert.ok(message.includes('How many customers pay in EUR?'));
  assert.ok(message.includes('"currency" text'));
});

test('evidence reaches the model when the record has it', () => {
  const message = buildUserMessage({
    question: 'How many customers pay in EUR?',
    evidence: "EUR customers = count(Currency = 'EUR')",
    schemaText: 'CREATE TABLE "customers" (\n  "currency" text\n);',
  });

  assert.ok(message.includes("EUR customers = count(Currency = 'EUR')"));
});

test('every failed attempt reaches the repair retry, not just the last', () => {
  // D14: the model sees the whole history so it cannot re-propose an attempt it
  // has already burned. A message carrying only the latest failure lets it.
  const message = buildUserMessage({
    question: 'How many customers pay in EUR?',
    evidence: '',
    schemaText: 'CREATE TABLE "customers" (\n  "currency" text\n);',
    failures: [
      { sql: 'SELECT bogus FROM customers', errorCode: '42703', errorMessage: 'column "bogus" does not exist' },
      { sql: 'SELECT * FROM missing', errorCode: '42P01', errorMessage: 'relation "missing" does not exist' },
    ],
  });

  assert.ok(message.includes('SELECT bogus FROM customers'));
  assert.ok(message.includes('column "bogus" does not exist'));
  assert.ok(message.includes('SELECT * FROM missing'));
  assert.ok(message.includes('42P01'));
});

test('a copied prompt file does not inherit the version it was copied from', () => {
  // v2 is v1 with one section changed, so the realistic mistake is copying the
  // file and leaving the version string behind. That stamps v2 runs as v1 in
  // every export, and no later comparison recovers from it.
  assert.notEqual(PROMPT_VERSION, v1.PROMPT_VERSION);
});
