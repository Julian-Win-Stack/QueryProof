import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildUserMessage } from './v1.ts';

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
