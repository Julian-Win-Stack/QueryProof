// The grouping and shipping rules, with injected deps — the same seam
// answer.test.ts and check.test.ts use. Whether N attempts actually agree in
// production is measured by eval runs, never asserted here.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Answer } from './answer.ts';
import type { ExecutionResult } from './execute-readonly.ts';
import { voteAnswer } from './vote.ts';

function answerWith(sql: string, execution: ExecutionResult): Answer {
  return {
    sql,
    execution,
    attempts: 1,
    failures: [],
    usage: { inputTokens: 100, outputTokens: 10, thinkingTokens: 4, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 110 },
    modelMs: 5,
    executionMs: 1,
    promptVersion: 'v3',
    rewrites: [],
  };
}

function ok(rows: unknown[][]): ExecutionResult {
  return { ok: true, rows, columns: ['c'], ms: 1 };
}

const failed: ExecutionResult = { ok: false, errorCode: '42703', errorMessage: 'no such column', errorPosition: null, ms: 1 };

function deps(answers: Answer[]) {
  let next = 0;
  return { answer: () => Promise.resolve(answers[next++]) };
}

const params = { question: 'q', evidence: '', schemaText: 'CREATE TABLE "t" ();' };

test('the largest group of same-rows results wins, matched by the grader not by identity', async () => {
  // Attempts 1 and 3 agree only under canonicalization — pg returns bigint as
  // a string, so the same right answer arrives as 2730 or '2730' depending on
  // the aggregate. Grouping by literal equality would split that vote.
  const voted = await voteAnswer(
    { ...params, repair: false, votes: 3 },
    deps([
      answerWith('SELECT a', ok([[2730]])),
      answerWith('SELECT b', ok([[391]])),
      answerWith('SELECT c', ok([['2730']])),
    ]),
  );

  assert.equal(voted.sql, 'SELECT a');
  assert.equal(voted.voteAgreement, 2);
});

test('a failed execution cannot vote, so one clean result beats any number of errors', async () => {
  const voted = await voteAnswer(
    { ...params, repair: false, votes: 3 },
    deps([
      answerWith('SELECT broken', failed),
      answerWith('SELECT fine', ok([[1]])),
      answerWith('SELECT broken2', failed),
    ]),
  );

  assert.equal(voted.sql, 'SELECT fine');
  assert.equal(voted.voteAgreement, 1);
});

test('when every attempt fails, the last failure ships with zero agreement', async () => {
  const voted = await voteAnswer(
    { ...params, repair: false, votes: 2 },
    deps([answerWith('SELECT broken', failed), answerWith('SELECT broken2', failed)]),
  );

  assert.equal(voted.sql, 'SELECT broken2');
  assert.equal(voted.execution.ok, false);
  assert.equal(voted.voteAgreement, 0);
});

test('a tie between groups goes to the first-seen result', async () => {
  const voted = await voteAnswer(
    { ...params, repair: false, votes: 2 },
    deps([answerWith('SELECT a', ok([[1]])), answerWith('SELECT b', ok([[2]]))]),
  );

  assert.equal(voted.sql, 'SELECT a');
  assert.equal(voted.voteAgreement, 1);
});

test('cost is the whole question: usage and time sum over every attempt, not the winner', async () => {
  const voted = await voteAnswer(
    { ...params, repair: false, votes: 3 },
    deps([
      answerWith('SELECT a', ok([[1]])),
      answerWith('SELECT a', ok([[1]])),
      answerWith('SELECT b', ok([[2]])),
    ]),
  );

  assert.equal(voted.usage.inputTokens, 300);
  assert.equal(voted.usage.outputTokens, 30);
  assert.equal(voted.usage.thinkingTokens, 12);
  assert.equal(voted.attempts, 3);
  assert.equal(voted.modelMs, 15);
  assert.equal(voted.executionMs, 3);
});
