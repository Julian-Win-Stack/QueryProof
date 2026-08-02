// Post-execution checks — the CHECK=probe and CHECK=self experiments. Both run
// after answerQuestion has produced its final answer, and both may replace it:
//
//   probe  fires when the query ran and returned zero rows, or one single-cell
//          row holding zero — a COUNT whose filter matched nothing looks like
//          [[0]], not []. The model writes ONE exploratory query, sees what it
//          returned, and rewrites.
//   self   fires whenever the query ran. The model sees the result and either
//          confirms the query unchanged or rewrites it.
//
// Whatever the check produces is the final answer and is scored as-is — a
// rewrite that breaks is an honest outcome, not a case to fall back from.
// Table selection and repair happened before this and never re-run.

import type { Answer } from './answer.ts';
import { executeReadOnly, type ExecutionResult } from './execute-readonly.ts';
import { completeJson, type ModelReply } from './model.ts';
import { applyNullsLast, applyTextCast } from './rewrites.ts';
import {
  buildProbeMessage,
  buildProbeRewriteMessage,
  buildSelfCheckMessage,
  formatResultPreview,
  PROBE_REWRITE_SYSTEM,
  PROBE_SYSTEM,
  SELF_CHECK_SYSTEM,
} from './prompts/check-v1.ts';

export type CheckMode = 'off' | 'probe' | 'self';

// 'skipped' — the trigger never fired (probe saw rows, or the query errored).
// The others say what the model did once asked.
export type CheckAction = 'skipped' | 'probed' | 'confirmed' | 'rewrote';

export type CheckedAnswer = Answer & { checkAction: CheckAction };

const SQL_SCHEMA = {
  type: 'object',
  properties: { sql: { type: 'string' } },
  required: ['sql'],
  additionalProperties: false,
};

type Deps = {
  complete: typeof completeJson;
  execute: (sql: string) => Promise<ExecutionResult>;
};

// deps exists for the pure tests on the trigger conditions — the defaults are
// the only callers in production.
export async function applyCheck(
  mode: CheckMode,
  params: { question: string; evidence: string; schemaText: string; rewrite?: boolean },
  answer: Answer,
  deps: Deps = { complete: completeJson, execute: executeReadOnly },
): Promise<CheckedAnswer> {
  if (mode === 'off') return { ...answer, checkAction: 'skipped' };
  if (!answer.execution.ok) return { ...answer, checkAction: 'skipped' };

  if (mode === 'probe') {
    if (!looksEmpty(answer.execution.rows)) return { ...answer, checkAction: 'skipped' };
    return probe(params, answer, deps);
  }
  return selfCheck(params, answer, deps);
}

// pg hands COUNT back as the string '0' (bigint), plain integer zeros as the
// number 0. NULL stays out: a scalar NULL can be the *correct* answer to an
// aggregate over an empty set, and probing it risks rewriting a right answer.
// Exported because the agent's bounce (src/agent.ts) fires on exactly the
// same trigger — the two must never drift apart.
export function looksEmpty(rows: unknown[][]): boolean {
  if (rows.length === 0) return true;
  if (rows.length !== 1 || rows[0].length !== 1) return false;
  return rows[0][0] === 0 || rows[0][0] === '0';
}

async function probe(
  params: { question: string; evidence: string; schemaText: string; rewrite?: boolean },
  answer: Answer,
  deps: Deps,
): Promise<CheckedAnswer> {
  const result = { ...answer, usage: { ...answer.usage }, checkAction: 'probed' as CheckAction };

  const probeReply = await deps.complete({
    system: PROBE_SYSTEM,
    user: buildProbeMessage({ ...params, sql: answer.sql }),
    schema: SQL_SCHEMA,
  });
  absorb(result, probeReply);
  const probeSql = readSql(probeReply.json);

  const probeExecution = await deps.execute(probeSql);
  result.executionMs += probeExecution.ms;
  const probeResultText = probeExecution.ok
    ? formatResultPreview(probeExecution.rows, probeExecution.columns)
    : `Postgres error${probeExecution.errorCode === null ? '' : ` ${probeExecution.errorCode}`}: ${probeExecution.errorMessage}`;

  const rewriteReply = await deps.complete({
    system: PROBE_REWRITE_SYSTEM,
    user: buildProbeRewriteMessage({ ...params, sql: answer.sql, probeSql, probeResultText }),
    schema: SQL_SCHEMA,
  });
  absorb(result, rewriteReply);

  await adoptWithRewrites(readSql(rewriteReply.json), params.rewrite, result, deps.execute);
  return result;
}

// Kept equal to answer.ts — the bound exists for the same multi-LIKE queries.
const MAX_TEXT_CASTS = 5;

// The check's rewrite becomes the scored answer, so it gets the same dialect
// repairs answerQuestion applies — otherwise turning the check on silently
// turns the repairs off for exactly the questions the check touches.
async function adoptWithRewrites(
  sql: string,
  rewrite: boolean | undefined,
  result: CheckedAnswer,
  execute: Deps['execute'],
): Promise<void> {
  let finalSql = sql;
  const fired = new Set(result.rewrites);

  if (rewrite === true) {
    const withNullsLast = applyNullsLast(finalSql);
    if (withNullsLast !== finalSql) {
      finalSql = withNullsLast;
      fired.add('nulls-last');
    }
  }

  let execution = await execute(finalSql);
  result.executionMs += execution.ms;

  if (rewrite === true) {
    for (let casts = 0; casts < MAX_TEXT_CASTS; casts++) {
      const cast = applyTextCast(finalSql, execution);
      if (cast === null) break;
      finalSql = cast;
      execution = await execute(finalSql);
      result.executionMs += execution.ms;
      fired.add('text-cast');
    }
  }

  result.sql = finalSql;
  result.execution = execution;
  result.rewrites = [...fired];
}

async function selfCheck(
  params: { question: string; evidence: string; schemaText: string; rewrite?: boolean },
  answer: Answer,
  deps: Deps,
): Promise<CheckedAnswer> {
  if (!answer.execution.ok) return { ...answer, checkAction: 'skipped' };
  const result = { ...answer, usage: { ...answer.usage }, checkAction: 'confirmed' as CheckAction };

  const reply = await deps.complete({
    system: SELF_CHECK_SYSTEM,
    user: buildSelfCheckMessage({
      ...params,
      sql: answer.sql,
      resultText: formatResultPreview(answer.execution.rows, answer.execution.columns),
    }),
    schema: SQL_SCHEMA,
  });
  absorb(result, reply);
  const finalSql = readSql(reply.json);

  if (finalSql.trim() === answer.sql.trim()) return result;

  await adoptWithRewrites(finalSql, params.rewrite, result, deps.execute);
  result.checkAction = 'rewrote';
  return result;
}

function absorb(answer: CheckedAnswer, reply: ModelReply): void {
  answer.usage.inputTokens += reply.usage.inputTokens;
  answer.usage.outputTokens += reply.usage.outputTokens;
  answer.usage.thinkingTokens += reply.usage.thinkingTokens;
  answer.usage.cacheCreationTokens += reply.usage.cacheCreationTokens;
  answer.usage.cacheReadTokens += reply.usage.cacheReadTokens;
  answer.usage.totalTokens += reply.usage.totalTokens;
  answer.modelMs += reply.ms;
}

function readSql(json: unknown): string {
  if (typeof json !== 'object' || json === null || !('sql' in json)) {
    throw new Error(`expected { sql: string }, got ${JSON.stringify(json)}`);
  }
  const { sql } = json;
  if (typeof sql !== 'string') throw new Error(`sql came back as ${typeof sql}, not a string`);
  return sql;
}
