// The trigger conditions and the replace-or-keep decision, with injected deps
// — the same seam answer.test.ts uses. Model quality is measured by eval runs,
// never asserted here.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Answer } from './answer.ts';
import { applyCheck } from './check.ts';
import type { ExecutionResult } from './execute-readonly.ts';
import type { ModelReply } from './model.ts';

function answerWith(execution: ExecutionResult): Answer {
  return {
    sql: 'SELECT 1',
    execution,
    attempts: 1,
    failures: [],
    usage: { inputTokens: 100, outputTokens: 10, thinkingTokens: 0, totalTokens: 110 },
    modelMs: 5,
    executionMs: 1,
    promptVersion: 'v1',
  };
}

const okEmpty: ExecutionResult = { ok: true, rows: [], columns: ['n'], ms: 1 };
const okOneRow: ExecutionResult = { ok: true, rows: [[42]], columns: ['n'], ms: 1 };
const failed: ExecutionResult = { ok: false, errorCode: '42703', errorMessage: 'no such column', ms: 1 };

function reply(sql: string): ModelReply {
  return {
    json: { sql },
    usage: { inputTokens: 200, outputTokens: 20, thinkingTokens: 8, totalTokens: 220 },
    rateLimit: {},
    ms: 7,
  };
}

type CompleteParams = { system: string; user: string; schema: Record<string, unknown> };

function deps(replies: string[], executions: ExecutionResult[]) {
  const completed: CompleteParams[] = [];
  const executed: string[] = [];
  return {
    completed,
    executed,
    complete: (params: CompleteParams) => {
      completed.push(params);
      return Promise.resolve(reply(replies[completed.length - 1]));
    },
    execute: (sql: string) => {
      executed.push(sql);
      return Promise.resolve(executions[executed.length - 1]);
    },
  };
}

function params(): { question: string; evidence: string; schemaText: string } {
  return { question: 'q', evidence: '', schemaText: 'CREATE TABLE "t" ();' };
}

test('off never calls the model', async () => {
  const d = deps([], []);
  const checked = await applyCheck('off', params(), answerWith(okEmpty), d);
  assert.equal(checked.checkAction, 'skipped');
  assert.equal(d.completed.length, 0);
});

test('probe skips unless the query ran and returned zero rows', async () => {
  for (const execution of [okOneRow, failed]) {
    const d = deps([], []);
    const checked = await applyCheck('probe', params(), answerWith(execution), d);
    assert.equal(checked.checkAction, 'skipped');
    assert.equal(d.completed.length, 0);
  }
});

test('probe on an empty result: explore, rewrite, adopt the rewrite', async () => {
  const d = deps(
    ['SELECT DISTINCT "x" FROM "t"', 'SELECT 2'],
    [okOneRow, okOneRow],
  );
  const checked = await applyCheck('probe', params(), answerWith(okEmpty), d);

  assert.equal(checked.checkAction, 'probed');
  assert.equal(checked.sql, 'SELECT 2');
  assert.deepEqual(d.executed, ['SELECT DISTINCT "x" FROM "t"', 'SELECT 2']);
  // Two extra model calls, summed on top of the generation call's usage.
  assert.equal(checked.usage.inputTokens, 100 + 200 + 200);
  assert.equal(checked.usage.outputTokens, 10 + 20 + 20);
});

test('probe keeps going when the exploratory query itself errors', async () => {
  const d = deps(['SELECT broken', 'SELECT 2'], [failed, okOneRow]);
  const checked = await applyCheck('probe', params(), answerWith(okEmpty), d);

  assert.equal(checked.checkAction, 'probed');
  assert.equal(checked.sql, 'SELECT 2');
  assert.ok(d.completed[1].user.includes('no such column'));
});

test('self-check confirming keeps the original execution without re-running it', async () => {
  const d = deps(['SELECT 1'], []);
  const checked = await applyCheck('self', params(), answerWith(okOneRow), d);

  assert.equal(checked.checkAction, 'confirmed');
  assert.equal(checked.sql, 'SELECT 1');
  assert.equal(checked.execution, okOneRow);
  assert.equal(d.executed.length, 0);
});

test('self-check rewriting executes and adopts the new query', async () => {
  const d = deps(['SELECT 2'], [okEmpty]);
  const checked = await applyCheck('self', params(), answerWith(okOneRow), d);

  assert.equal(checked.checkAction, 'rewrote');
  assert.equal(checked.sql, 'SELECT 2');
  assert.equal(checked.execution, okEmpty);
});

test('self-check skips a query that failed to execute', async () => {
  const d = deps([], []);
  const checked = await applyCheck('self', params(), answerWith(failed), d);
  assert.equal(checked.checkAction, 'skipped');
  assert.equal(d.completed.length, 0);
});
