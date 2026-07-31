// Phase 7 — self-repair. One question, at most three tries: on a Postgres
// error the model sees the original prompt plus every previous failed SQL and
// its error, and answers again (D14). Table selection happened before this
// function was called and never re-runs — repair and selection changing
// together would make neither delta attributable.
//
// Only an execution error is a repair case. A query that runs and returns the
// wrong rows has no signal to repair against, and a statement timeout (57014)
// is a plain failure — retrying the slowest queries in the set is where money
// goes to die (D13).

import { executeReadOnly, type ExecutionResult } from './execute-readonly.ts';
import { generateSql, type GeneratedSql } from './generate-sql.ts';
import { type Usage } from './model.ts';
import { type FailedAttempt } from './prompts/v1.ts';

const MAX_RETRIES = 2;

const TIMEOUT_CODE = '57014';

export type Answer = {
  sql: string;
  execution: ExecutionResult;
  attempts: number;
  failures: FailedAttempt[];
  // Summed over every attempt, so cost-per-question stays honest when a
  // question was answered three times.
  usage: Usage;
  modelMs: number;
  executionMs: number;
  promptVersion: string;
};

type Deps = {
  generate: (params: {
    question: string;
    evidence: string;
    schemaText: string;
    failures: FailedAttempt[];
  }) => Promise<GeneratedSql>;
  execute: (sql: string) => Promise<ExecutionResult>;
};

// deps exists for the pure tests on the stopping conditions — the defaults are
// the only callers in production.
export async function answerQuestion(
  params: { question: string; evidence: string; schemaText: string; repair: boolean },
  deps: Deps = { generate: generateSql, execute: executeReadOnly },
): Promise<Answer> {
  const failures: FailedAttempt[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, totalTokens: 0 };
  let modelMs = 0;
  let executionMs = 0;

  for (let attempt = 1; ; attempt++) {
    const generated = await deps.generate({
      question: params.question,
      evidence: params.evidence,
      schemaText: params.schemaText,
      failures,
    });
    usage.inputTokens += generated.usage.inputTokens;
    usage.outputTokens += generated.usage.outputTokens;
    usage.thinkingTokens += generated.usage.thinkingTokens;
    usage.totalTokens += generated.usage.totalTokens;
    modelMs += generated.ms;

    const execution = await deps.execute(generated.sql);
    executionMs += execution.ms;

    const repairable =
      params.repair &&
      !execution.ok &&
      execution.errorCode !== TIMEOUT_CODE &&
      attempt <= MAX_RETRIES;

    if (!repairable) {
      return {
        sql: generated.sql,
        execution,
        attempts: attempt,
        failures,
        usage,
        modelMs,
        executionMs,
        promptVersion: generated.promptVersion,
      };
    }

    failures.push({
      sql: generated.sql,
      errorCode: execution.errorCode,
      errorMessage: execution.errorMessage,
    });
  }
}
