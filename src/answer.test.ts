// The stopping conditions of the repair loop (Phase 7). Pure — the model and
// the database are both injected fakes.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { answerQuestion } from './answer.ts';
import type { ExecutionResult } from './execute-readonly.ts';
import type { GeneratedSql } from './generate-sql.ts';
import type { FailedAttempt } from './prompts/v1.ts';

const QUESTION = { question: 'How many?', evidence: '', schemaText: 'schema' };

function generated(sql: string): GeneratedSql {
  return {
    sql,
    promptVersion: 'v1',
    usage: { inputTokens: 100, outputTokens: 10, thinkingTokens: 5, totalTokens: 110 },
    ms: 1,
  };
}

const ROWS: ExecutionResult = { ok: true, rows: [[1]], columns: ['count'], ms: 1 };

function pgError(code: string | null): ExecutionResult {
  return { ok: false, errorCode: code, errorMessage: `error ${code ?? 'none'}`, ms: 1 };
}

// Returns canned replies in order and records the failure history each
// generate call was shown.
function fakeModel(replies: string[]) {
  const historySeen: FailedAttempt[][] = [];
  return {
    historySeen,
    generate: (params: { failures: FailedAttempt[] }) => {
      historySeen.push([...params.failures]);
      const sql = replies[historySeen.length - 1];
      if (sql === undefined) throw new Error('generate called more often than the test planned');
      return Promise.resolve(generated(sql));
    },
  };
}

function fakeDb(results: Record<string, ExecutionResult>) {
  return (sql: string) => {
    const result = results[sql];
    if (result === undefined) throw new Error(`no canned result for ${sql}`);
    return Promise.resolve(result);
  };
}

test('a query that executes is final — even a wrong answer is not a repair case', async () => {
  const model = fakeModel(['select 1']);
  const answer = await answerQuestion(
    { ...QUESTION, repair: true },
    { generate: model.generate, execute: fakeDb({ 'select 1': ROWS }) },
  );

  assert.equal(answer.attempts, 1);
  assert.equal(answer.sql, 'select 1');
  assert.deepEqual(answer.failures, []);
});

test('repair off: a Postgres error is returned after one attempt', async () => {
  const model = fakeModel(['select broken']);
  const answer = await answerQuestion(
    { ...QUESTION, repair: false },
    { generate: model.generate, execute: fakeDb({ 'select broken': pgError('42703') }) },
  );

  assert.equal(answer.attempts, 1);
  assert.equal(answer.execution.ok, false);
});

test('repair on: the retry sees every previous failure, and a fix counts its attempts', async () => {
  const model = fakeModel(['select broken', 'select fixed']);
  const answer = await answerQuestion(
    { ...QUESTION, repair: true },
    {
      generate: model.generate,
      execute: fakeDb({ 'select broken': pgError('42703'), 'select fixed': ROWS }),
    },
  );

  assert.equal(answer.attempts, 2);
  assert.equal(answer.sql, 'select fixed');
  assert.equal(answer.execution.ok, true);
  assert.deepEqual(model.historySeen[0], []);
  assert.deepEqual(model.historySeen[1], [
    { sql: 'select broken', errorCode: '42703', errorMessage: 'error 42703' },
  ]);
  // Usage is the sum of both attempts, not the last one.
  assert.equal(answer.usage.inputTokens, 200);
  assert.equal(answer.usage.outputTokens, 20);
});

test('repair stops after 2 retries: three attempts, then the error stands', async () => {
  const model = fakeModel(['select a', 'select b', 'select c']);
  const answer = await answerQuestion(
    { ...QUESTION, repair: true },
    {
      generate: model.generate,
      execute: fakeDb({
        'select a': pgError('42703'),
        'select b': pgError('42P01'),
        'select c': pgError('42601'),
      }),
    },
  );

  assert.equal(answer.attempts, 3);
  assert.equal(answer.sql, 'select c');
  assert.equal(answer.execution.ok, false);
  // The third attempt saw both earlier failures (D14: full history).
  assert.deepEqual(
    model.historySeen[2]?.map((failure) => failure.sql),
    ['select a', 'select b'],
  );
});

test('a statement timeout is a plain failure, never a repair case (D13)', async () => {
  const model = fakeModel(['select slow']);
  const answer = await answerQuestion(
    { ...QUESTION, repair: true },
    { generate: model.generate, execute: fakeDb({ 'select slow': pgError('57014') }) },
  );

  assert.equal(answer.attempts, 1);
  assert.equal(answer.execution.ok, false);
});
