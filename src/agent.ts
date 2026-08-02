// The agent — the alternative to answerQuestion + applyCheck. The model gets
// three tools (inspect a column, run a query, submit the answer) and up to
// MAX_PASSES model calls to use them; our code only executes what it asks for
// and feeds the result back. The pipeline guesses between two similar-looking
// columns and we grade the guess; the agent can look first.
//
// Table selection happened before this function was called, exactly as it does
// for the pipeline — the agent sees the same schema text, so accuracy deltas
// attribute to the loop, not to different information.
//
// It returns the pipeline's Answer shape, so scoring, export, triage, diff and
// rescore all work unchanged. A refusal or exhausted 429 throws, which voids
// the question rather than scoring zero (D19).

import type Anthropic from '@anthropic-ai/sdk';

import type { Answer } from './answer.ts';
import { looksEmpty } from './check.ts';
import { executeReadOnly, type ExecutionResult } from './execute-readonly.ts';
import { completeWithTools, type Usage } from './model.ts';
import {
  AGENT_PROMPT_VERSION,
  AGENT_SYSTEM,
  buildAgentUserMessage,
} from './prompts/agent-v3.ts';
import { formatResultPreview } from './prompts/check-v1.ts';
import { applyNullsLast, applyTextCast } from './rewrites.ts';
import type { Table } from './schema.ts';

// Model calls per question, hard floor under the dedupe below. On the last
// pass tool_choice forces submit_sql, so the loop always ends holding a query
// — a bad answer is data, no answer is a hole.
const MAX_PASSES = 10;

// A second prose-only reply forces submission on the next pass — a model that
// will not use its tools twice in a row is not going to start on pass seven.
const MAX_PROSE_STRIKES = 2;

// Distinct stored values shown per inspect_column call.
const INSPECT_LIMIT = 20;

// Kept equal to answer.ts — the bound exists for the same multi-LIKE queries.
const MAX_TEXT_CASTS = 5;

// A submission that errors or comes back empty goes back to the model once —
// the agent's version of the pipeline's repair (error) and probe (empty)
// safety nets, which switching the agent on otherwise switches off. One
// bounce, like the probe's one retry: more invites churning a right answer.
const MAX_BOUNCES = 1;

// How the loop ended. 'submitted' — the model called submit_sql on its own.
// 'forced-cap' — pass MAX_PASSES arrived and tool_choice forced it.
// 'forced-prose' — it answered in prose twice, so tool_choice forced it early.
export type AgentStop = 'submitted' | 'forced-cap' | 'forced-prose';

export type AgentAnswer = Answer & {
  agentStop: AgentStop;
  // Model calls made (attempts carries the same number, for the shared tooling).
  agentPasses: number;
  // Tool calls executed, dedupe hits among them, split by tool.
  agentInspects: number;
  agentRuns: number;
  agentDedupeHits: number;
  // Submissions sent back for erroring or coming up empty (0 or 1).
  agentBounces: number;
};

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'inspect_column',
    description:
      `See what a column actually stores: the ${INSPECT_LIMIT} most common distinct values with their counts. ` +
      'Use it before filtering on a literal value, or to choose between similar-looking columns.',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name exactly as the schema spells it' },
        column: { type: 'string', description: 'Column name exactly as the schema spells it' },
      },
      required: ['table', 'column'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'run_sql',
    description:
      'Run a SELECT against the database and see the result (first 20 rows). Use it to verify your query before submitting.',
    input_schema: {
      type: 'object',
      properties: { sql: { type: 'string' } },
      required: ['sql'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'submit_sql',
    description: 'Hand in your final SQL answer to the question. This ends the session.',
    input_schema: {
      type: 'object',
      properties: { sql: { type: 'string' } },
      required: ['sql'],
      additionalProperties: false,
    },
    strict: true,
  },
];

const SUBMIT_TOOL: Anthropic.ToolChoice = { type: 'tool', name: 'submit_sql' };

const NUDGE =
  'Reply using your tools only. When you are ready, call submit_sql with your final query.';

type Deps = {
  complete: typeof completeWithTools;
  execute: (sql: string) => Promise<ExecutionResult>;
};

// deps exists for the pure tests on the loop's stopping conditions — the
// defaults are the only callers in production.
export async function agentAnswer(
  params: {
    question: string;
    evidence: string;
    schemaText: string;
    tables: Table[];
    rewrite?: boolean;
  },
  deps: Deps = { complete: completeWithTools, execute: executeReadOnly },
): Promise<AgentAnswer> {
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildAgentUserMessage(params) },
  ];
  const usage: Usage = {
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
  };
  // What it already asked, keyed by tool name + arguments. A repeat gets the
  // stored answer back with a note — this, not the pass cap, is what stops a
  // model from spinning; the cap is only the hard floor under it.
  const seen = new Map<string, { content: string; isError: boolean }>();

  let modelMs = 0;
  let executionMs = 0;
  let proseStrikes = 0;
  let inspects = 0;
  let runs = 0;
  let dedupeHits = 0;
  let passes = 0;
  let bounces = 0;
  let final: { sql: string; execution: ExecutionResult; rewrites: string[] } | undefined;
  let stop: AgentStop = 'submitted';

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    const forced = pass === MAX_PASSES || proseStrikes >= MAX_PROSE_STRIKES;
    passes = pass;

    const reply = await deps.complete({
      system: AGENT_SYSTEM,
      messages,
      tools: TOOLS,
      ...(forced ? { toolChoice: SUBMIT_TOOL } : {}),
    });
    usage.inputTokens += reply.usage.inputTokens;
    usage.outputTokens += reply.usage.outputTokens;
    usage.thinkingTokens += reply.usage.thinkingTokens;
    usage.cacheCreationTokens += reply.usage.cacheCreationTokens;
    usage.cacheReadTokens += reply.usage.cacheReadTokens;
    usage.totalTokens += reply.usage.totalTokens;
    modelMs += reply.ms;

    const toolUses = reply.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    // Prose and no tool call — the confused case. Nudge once; a second strike
    // flips `forced` above so the next call must submit.
    if (toolUses.length === 0) {
      proseStrikes += 1;
      messages.push({ role: 'assistant', content: reply.content });
      messages.push({ role: 'user', content: NUDGE });
      continue;
    }

    const submit = toolUses.find((use) => use.name === 'submit_sql');
    if (submit !== undefined) {
      stop = !forced ? 'submitted' : pass === MAX_PASSES ? 'forced-cap' : 'forced-prose';
      // Score the submission right here so a bad one can go back into the
      // conversation. Forced submissions ship as-is: at the cap there are no
      // passes left, and a model that had to be pushed off prose twice is not
      // going to use another chance well.
      const scored = await executeWithRewrites(
        readSqlInput(submit.input),
        params.rewrite === true,
        deps.execute,
      );
      executionMs += scored.ms;
      final = { sql: scored.sql, execution: scored.execution, rewrites: scored.rewrites };
      const reason = bounceReason(scored.execution);
      if (reason === null || stop !== 'submitted' || bounces >= MAX_BOUNCES) break;
      bounces += 1;
      final = undefined;
      messages.push({ role: 'assistant', content: reply.content });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: submit.id,
            content: reason,
            ...(scored.execution.ok ? {} : { is_error: true }),
          },
        ],
      });
      continue;
    }

    // The whole content array goes back as the assistant turn — stripping
    // thinking blocks 400s on ordering. Every tool_use gets its result, all in
    // one user message; splitting them trains the model out of parallel calls.
    messages.push({ role: 'assistant', content: reply.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const key = `${use.name} ${JSON.stringify(use.input)}`;
      const cached = seen.get(key);
      let outcome: { content: string; isError: boolean };
      if (cached !== undefined) {
        dedupeHits += 1;
        outcome = {
          content: `You already asked this — same result:\n${cached.content}`,
          isError: cached.isError,
        };
      } else {
        const startedAt = Date.now();
        outcome =
          use.name === 'inspect_column'
            ? await inspectColumn(use.input, params.tables, deps.execute)
            : await runSql(use.input, deps.execute);
        executionMs += Date.now() - startedAt;
        if (use.name === 'inspect_column') inspects += 1;
        else runs += 1;
        seen.set(key, outcome);
      }
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: outcome.content,
        ...(outcome.isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: 'user', content: results });
  }

  // Unreachable in production: the MAX_PASSES iteration forces submit_sql via
  // tool_choice, so the loop can only exit holding a scored submission.
  if (final === undefined) {
    throw new Error('agent loop ended without a submitted query');
  }

  return {
    sql: final.sql,
    execution: final.execution,
    attempts: passes,
    failures: [],
    usage,
    modelMs,
    executionMs,
    promptVersion: AGENT_PROMPT_VERSION,
    rewrites: final.rewrites,
    agentStop: stop,
    agentPasses: passes,
    agentInspects: inspects,
    agentRuns: runs,
    agentDedupeHits: dedupeHits,
    agentBounces: bounces,
  };
}

// Null means the submission stands. A string is the tool_result content that
// sends it back — mirroring what the pipeline's repair loop (Postgres error)
// and probe (empty or single-cell-zero result, `looksEmpty`) would have
// caught. An empty result can be the correct answer, so the message leaves an
// explicit path to insist: resubmitting the same query ships it.
function bounceReason(execution: ExecutionResult): string | null {
  if (!execution.ok) {
    return (
      `Your submitted query failed — Postgres error${execution.errorCode === null ? '' : ` ${execution.errorCode}`}: ` +
      `${execution.errorMessage}. Fix the query, run it, and submit again.`
    );
  }
  if (looksEmpty(execution.rows)) {
    return (
      'Your submitted query returned nothing — zero rows, or a single zero. If that is not the answer you expected, ' +
      'a filter literal, column choice or join is probably wrong: inspect the columns you filtered on, then submit a ' +
      'corrected query. If the empty result is genuinely correct, submit the same query again.'
    );
  }
  return null;
}

// The submitted query gets the same deterministic dialect repairs the pipeline
// applies (REWRITE) — otherwise switching the agent on silently switches the
// repairs off, and the delta stops attributing to the loop.
async function executeWithRewrites(
  submitted: string,
  rewrite: boolean,
  execute: Deps['execute'],
): Promise<{ sql: string; execution: ExecutionResult; rewrites: string[]; ms: number }> {
  const fired = new Set<string>();
  let sql = submitted;
  let ms = 0;

  if (rewrite) {
    const withNullsLast = applyNullsLast(sql);
    if (withNullsLast !== sql) {
      sql = withNullsLast;
      fired.add('nulls-last');
    }
  }

  let execution = await execute(sql);
  ms += execution.ms;

  if (rewrite) {
    for (let casts = 0; casts < MAX_TEXT_CASTS; casts++) {
      const cast = applyTextCast(sql, execution);
      if (cast === null) break;
      sql = cast;
      execution = await execute(sql);
      ms += execution.ms;
      fired.add('text-cast');
    }
  }

  return { sql, execution, rewrites: [...fired], ms };
}

// Postgres wants embedded double quotes doubled inside a quoted identifier.
function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

async function inspectColumn(
  input: unknown,
  tables: Table[],
  execute: Deps['execute'],
): Promise<{ content: string; isError: boolean }> {
  const { table, column } = readInspectInput(input);

  const found = tables.find((candidate) => candidate.name === table);
  if (found === undefined) {
    return {
      content: `table "${table}" is not in your schema. Tables available: ${tables.map((t) => t.name).join(', ')}`,
      isError: true,
    };
  }
  if (!found.columns.some((candidate) => candidate.name === column)) {
    return {
      content: `column "${column}" is not on "${table}". Its columns: ${found.columns.map((c) => c.name).join(', ')}`,
      isError: true,
    };
  }

  const identifier = quoteIdentifier(column);
  const execution = await execute(
    `SELECT ${identifier} AS value, COUNT(*) AS occurrences FROM ${quoteIdentifier(table)} GROUP BY ${identifier} ORDER BY occurrences DESC LIMIT ${INSPECT_LIMIT}`,
  );
  if (!execution.ok) {
    return {
      content: `Postgres error${execution.errorCode === null ? '' : ` ${execution.errorCode}`}: ${execution.errorMessage}`,
      isError: true,
    };
  }
  return {
    content: `Most common values in "${table}"."${column}" (value, count):\n${formatResultPreview(execution.rows, execution.columns)}`,
    isError: false,
  };
}

async function runSql(
  input: unknown,
  execute: Deps['execute'],
): Promise<{ content: string; isError: boolean }> {
  const execution = await execute(readSqlInput(input));
  if (!execution.ok) {
    return {
      content: `Postgres error${execution.errorCode === null ? '' : ` ${execution.errorCode}`}: ${execution.errorMessage}`,
      isError: true,
    };
  }
  return { content: formatResultPreview(execution.rows, execution.columns), isError: false };
}

// The strict input schemas make these shapes a contract — a failure here is
// the contract breaking, worth a throw (voids the question), not a tool error
// the model gets to retry.
function readSqlInput(input: unknown): string {
  if (typeof input !== 'object' || input === null || !('sql' in input) || typeof input.sql !== 'string') {
    throw new Error(`expected { sql: string }, got ${JSON.stringify(input)}`);
  }
  return input.sql;
}

function readInspectInput(input: unknown): { table: string; column: string } {
  if (
    typeof input !== 'object' ||
    input === null ||
    !('table' in input) ||
    !('column' in input) ||
    typeof input.table !== 'string' ||
    typeof input.column !== 'string'
  ) {
    throw new Error(`expected { table: string, column: string }, got ${JSON.stringify(input)}`);
  }
  return { table: input.table, column: input.column };
}
