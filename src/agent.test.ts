// The agent loop's stopping conditions and bookkeeping. Pure — the model and
// the database are both injected fakes.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { agentAnswer } from './agent.ts';
import type { ExecutionResult } from './execute-readonly.ts';
import type { ToolReply } from './model.ts';
import type { Table } from './schema.ts';

const TABLES: Table[] = [
  {
    name: 'cards',
    columns: [
      { name: 'type', type: 'text', nullable: true },
      { name: 'types', type: 'text', nullable: true },
    ],
    primaryKey: ['type'],
    foreignKeys: [],
  },
];

const QUESTION = { question: 'How many?', evidence: '', schemaText: 'schema', tables: TABLES };

const ROWS: ExecutionResult = { ok: true, rows: [[1]], columns: ['count'], ms: 1 };

function toolUse(name: string, input: Record<string, unknown>, id = 'toolu_1'): Anthropic.ToolUseBlock {
  return { type: 'tool_use', id, name, input, caller: { type: 'direct' } };
}

function reply(content: Anthropic.ContentBlock[]): ToolReply {
  return {
    content,
    stopReason: content.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn',
    usage: {
      inputTokens: 100,
      outputTokens: 10,
      thinkingTokens: 5,
      cacheCreationTokens: 20,
      cacheReadTokens: 80,
      totalTokens: 210,
    },
    ms: 1,
  };
}

const prose: Anthropic.ContentBlock[] = [{ type: 'text', text: 'Let me think.', citations: null }];

// Returns canned replies in order and records what each call was sent.
function fakeModel(replies: Anthropic.ContentBlock[][]) {
  const calls: Array<{ messages: Anthropic.MessageParam[]; toolChoice: Anthropic.ToolChoice | undefined }> = [];
  return {
    calls,
    complete: (params: {
      messages: Anthropic.MessageParam[];
      toolChoice?: Anthropic.ToolChoice;
    }): Promise<ToolReply> => {
      calls.push({ messages: structuredClone(params.messages), toolChoice: params.toolChoice });
      const content = replies[calls.length - 1];
      if (content === undefined) throw new Error('complete called more often than the test planned');
      return Promise.resolve(reply(content));
    },
  };
}

function fakeExecute(
  respond: (sql: string) => ExecutionResult = () => ROWS,
): { sqlSeen: string[]; execute: (sql: string) => Promise<ExecutionResult> } {
  const sqlSeen: string[] = [];
  return {
    sqlSeen,
    execute: (sql: string) => {
      sqlSeen.push(sql);
      return Promise.resolve(respond(sql));
    },
  };
}

test('submitting on the first pass ends the loop as "submitted" after one model call', async () => {
  const model = fakeModel([[toolUse('submit_sql', { sql: 'SELECT 1' })]]);
  const db = fakeExecute();

  const answer = await agentAnswer(QUESTION, { complete: model.complete, execute: db.execute });

  assert.equal(answer.agentStop, 'submitted');
  assert.equal(answer.agentPasses, 1);
  assert.equal(answer.agentBounces, 0);
  assert.equal(answer.sql, 'SELECT 1');
  // The submitted query is executed fresh for scoring.
  assert.deepEqual(db.sqlSeen, ['SELECT 1']);
  assert.equal(answer.execution.ok, true);
});

// Reproduces the bird-0110 loss (2026-08-01 agent run): DISTINCT added after
// the last test run made the submission error at scoring, with no way back.
test('a submission that errors goes back to the model once and the fix ships', async () => {
  const model = fakeModel([
    [toolUse('submit_sql', { sql: 'BROKEN' })],
    [toolUse('submit_sql', { sql: 'SELECT 1' }, 'toolu_2')],
  ]);
  const db = fakeExecute((sql) =>
    sql === 'BROKEN'
      ? { ok: false, errorCode: '42P10', errorMessage: 'bad query', errorPosition: null, ms: 1 }
      : ROWS,
  );

  const answer = await agentAnswer(QUESTION, { complete: model.complete, execute: db.execute });

  assert.equal(answer.agentStop, 'submitted');
  assert.equal(answer.agentBounces, 1);
  assert.equal(answer.agentPasses, 2);
  assert.equal(answer.sql, 'SELECT 1');
  assert.equal(answer.execution.ok, true);
  // The failed submission came back as an error tool_result naming the code.
  const bounced = model.calls[1].messages[2].content as Anthropic.ToolResultBlockParam[];
  assert.equal(bounced[0].tool_use_id, 'toolu_1');
  assert.equal(bounced[0].is_error, true);
  assert.match(bounced[0].content as string, /42P10/);
});

// Reproduces the bird-0443/0462 losses (2026-08-01 agent run): a 0-row answer
// submitted without a second thought. The resubmit path exists because an
// empty result can be correct — the bounce must not force a different answer.
test('a submission with an empty result bounces once; resubmitting it ships it', async () => {
  const model = fakeModel([
    [toolUse('submit_sql', { sql: 'SELECT 2' })],
    [toolUse('submit_sql', { sql: 'SELECT 2' }, 'toolu_2')],
  ]);
  const db = fakeExecute(() => ({ ok: true, rows: [], columns: ['count'], ms: 1 }));

  const answer = await agentAnswer(QUESTION, { complete: model.complete, execute: db.execute });

  assert.equal(answer.agentStop, 'submitted');
  assert.equal(answer.agentBounces, 1);
  assert.equal(answer.agentPasses, 2);
  // Bounced, resubmitted identically, shipped — executed once per submission.
  assert.deepEqual(db.sqlSeen, ['SELECT 2', 'SELECT 2']);
  assert.equal(answer.execution.ok, true);
  // An empty result is a valid result, not a tool error.
  const bounced = model.calls[1].messages[2].content as Anthropic.ToolResultBlockParam[];
  assert.equal(bounced[0].is_error, undefined);
  assert.match(bounced[0].content as string, /returned nothing/);
});

test('a forced submission ships without a bounce even when it comes back empty', async () => {
  const lookups = Array.from({ length: 9 }, (_, i) => [
    toolUse('run_sql', { sql: `SELECT ${i}` }, `toolu_${i}`),
  ]);
  const model = fakeModel([...lookups, [toolUse('submit_sql', { sql: 'SELECT 9' })]]);
  const db = fakeExecute(() => ({ ok: true, rows: [], columns: ['count'], ms: 1 }));

  const answer = await agentAnswer(QUESTION, { complete: model.complete, execute: db.execute });

  assert.equal(answer.agentStop, 'forced-cap');
  assert.equal(answer.agentBounces, 0);
  assert.equal(answer.agentPasses, 10);
});

test('a tool request is executed and its result goes back before the next pass', async () => {
  const model = fakeModel([
    [toolUse('run_sql', { sql: 'SELECT 2' })],
    [toolUse('submit_sql', { sql: 'SELECT 2' })],
  ]);
  const db = fakeExecute();

  const answer = await agentAnswer(QUESTION, { complete: model.complete, execute: db.execute });

  assert.equal(answer.agentPasses, 2);
  assert.equal(answer.agentRuns, 1);
  // Second call carries: original question, assistant tool_use turn, tool_result turn.
  const second = model.calls[1].messages;
  assert.equal(second.length, 3);
  assert.equal(second[1].role, 'assistant');
  const results = second[2].content as Anthropic.ToolResultBlockParam[];
  assert.equal(results[0].type, 'tool_result');
  assert.equal(results[0].tool_use_id, 'toolu_1');
});

test('the tenth pass forces submit_sql and records "forced-cap"', async () => {
  const lookups = Array.from({ length: 9 }, (_, i) => [
    toolUse('run_sql', { sql: `SELECT ${i}` }, `toolu_${i}`),
  ]);
  const model = fakeModel([...lookups, [toolUse('submit_sql', { sql: 'SELECT 9' })]]);
  const db = fakeExecute();

  const answer = await agentAnswer(QUESTION, { complete: model.complete, execute: db.execute });

  assert.equal(answer.agentStop, 'forced-cap');
  assert.equal(answer.agentPasses, 10);
  assert.equal(model.calls[8].toolChoice, undefined);
  assert.deepEqual(model.calls[9].toolChoice, { type: 'tool', name: 'submit_sql' });
});

test('a repeated identical lookup is answered from memory, not re-executed', async () => {
  const model = fakeModel([
    [toolUse('run_sql', { sql: 'SELECT 2' })],
    [toolUse('run_sql', { sql: 'SELECT 2' }, 'toolu_2')],
    [toolUse('submit_sql', { sql: 'SELECT 2' })],
  ]);
  const db = fakeExecute();

  const answer = await agentAnswer(QUESTION, { complete: model.complete, execute: db.execute });

  assert.equal(answer.agentDedupeHits, 1);
  // Executed once as a tool, once fresh for the final scoring — never twice as a tool.
  assert.deepEqual(db.sqlSeen, ['SELECT 2', 'SELECT 2']);
  const repeat = model.calls[2].messages[4].content as Anthropic.ToolResultBlockParam[];
  assert.match(repeat[0].content as string, /already asked/);
});

test('two prose replies force submission and record "forced-prose"', async () => {
  const model = fakeModel([prose, prose, [toolUse('submit_sql', { sql: 'SELECT 3' })]]);
  const db = fakeExecute();

  const answer = await agentAnswer(QUESTION, { complete: model.complete, execute: db.execute });

  assert.equal(answer.agentStop, 'forced-prose');
  assert.equal(answer.agentPasses, 3);
  assert.equal(model.calls[1].toolChoice, undefined);
  assert.deepEqual(model.calls[2].toolChoice, { type: 'tool', name: 'submit_sql' });
  // Each prose reply got a nudge back.
  const third = model.calls[2].messages;
  assert.equal(third.filter((m) => m.role === 'user' && typeof m.content === 'string').length, 3);
});

test('parallel tool requests all get results in one user message', async () => {
  const model = fakeModel([
    [
      toolUse('inspect_column', { table: 'cards', column: 'type' }, 'toolu_a'),
      toolUse('inspect_column', { table: 'cards', column: 'types' }, 'toolu_b'),
    ],
    [toolUse('submit_sql', { sql: 'SELECT 4' })],
  ]);
  const db = fakeExecute();

  const answer = await agentAnswer(QUESTION, { complete: model.complete, execute: db.execute });

  assert.equal(answer.agentInspects, 2);
  const results = model.calls[1].messages[2].content as Anthropic.ToolResultBlockParam[];
  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((result) => result.tool_use_id),
    ['toolu_a', 'toolu_b'],
  );
});

test('inspecting a table outside the schema returns an error result instead of running SQL', async () => {
  const model = fakeModel([
    [toolUse('inspect_column', { table: 'races', column: 'type' })],
    [toolUse('submit_sql', { sql: 'SELECT 5' })],
  ]);
  const db = fakeExecute();

  await agentAnswer(QUESTION, { complete: model.complete, execute: db.execute });

  // Only the final scoring execution — the bad inspect never reached the db.
  assert.deepEqual(db.sqlSeen, ['SELECT 5']);
  const results = model.calls[1].messages[2].content as Anthropic.ToolResultBlockParam[];
  assert.equal(results[0].is_error, true);
  assert.match(results[0].content as string, /not in your schema/);
});

test('usage sums over every pass, cache fields included', async () => {
  const model = fakeModel([
    [toolUse('run_sql', { sql: 'SELECT 2' })],
    [toolUse('submit_sql', { sql: 'SELECT 2' })],
  ]);
  const db = fakeExecute();

  const answer = await agentAnswer(QUESTION, { complete: model.complete, execute: db.execute });

  assert.equal(answer.usage.inputTokens, 200);
  assert.equal(answer.usage.cacheCreationTokens, 40);
  assert.equal(answer.usage.cacheReadTokens, 160);
  assert.equal(answer.usage.totalTokens, 420);
});
