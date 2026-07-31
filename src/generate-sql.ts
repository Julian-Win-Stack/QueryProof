// Question + evidence + schema text -> SQL. The model's only decision in
// Version A: which tables it sees was decided before this function was called,
// and what happens to the SQL is decided after.

import { completeJson, type Usage } from './model.ts';
import { buildUserMessage, PROMPT_VERSION, SYSTEM, type FailedAttempt } from './prompts/v1.ts';

const SQL_SCHEMA = {
  type: 'object',
  properties: { sql: { type: 'string' } },
  required: ['sql'],
  additionalProperties: false,
};

export type GeneratedSql = {
  sql: string;
  promptVersion: string;
  usage: Usage;
  ms: number;
};

export async function generateSql(params: {
  question: string;
  evidence: string;
  schemaText: string;
  failures?: FailedAttempt[];
}): Promise<GeneratedSql> {
  const reply = await completeJson({
    system: SYSTEM,
    user: buildUserMessage(params),
    schema: SQL_SCHEMA,
  });

  return {
    sql: readSql(reply.json),
    promptVersion: PROMPT_VERSION,
    usage: reply.usage,
    ms: reply.ms,
  };
}

// The output schema makes this shape a contract, so a failure here is the
// contract breaking rather than the model rambling — worth a throw, not a
// scored wrong answer.
function readSql(json: unknown): string {
  if (typeof json !== 'object' || json === null || !('sql' in json)) {
    throw new Error(`expected { sql: string }, got ${JSON.stringify(json)}`);
  }
  const { sql } = json;
  if (typeof sql !== 'string') throw new Error(`sql came back as ${typeof sql}, not a string`);
  return sql;
}
