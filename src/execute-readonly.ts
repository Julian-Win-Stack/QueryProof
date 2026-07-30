// The only path generated SQL takes to the database. The wall is the
// queryproof_ro role, which holds SELECT and nothing else — not a regex over
// the SQL text, which a model can walk around with a comment or a CTE.

import { DatabaseError, Pool } from 'pg';

const READONLY_ROLE = 'queryproof_ro';

// Matches gold validation. A timeout is a plain failure, never a repair case
// (D13) — errorCode 57014 makes them countable.
const STATEMENT_TIMEOUT_MS = 15_000;

// Independent of eval concurrency (D12a). Postgres max_connections defaults to
// 100 and every question runs two queries, so an uncapped pool surfaces
// "too many clients already" as an execution error that reads as bad SQL.
const POOL_MAX = 20;

// The dump's timestamptz literals all carry +08. See KNOWN_ISSUES.md.
const SESSION_TIME_ZONE = 'Asia/Shanghai';

export type ExecutionResult =
  | { ok: true; rows: unknown[][]; columns: string[]; ms: number }
  | { ok: false; errorCode: string | null; errorMessage: string; ms: number };

let pool: Pool | undefined;

function readOnlyPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL_RO;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL_RO is not set. Run scripts/create-ro-role.sql, then add it to .env — see CLAUDE.md.',
    );
  }
  if (new URL(connectionString).username !== READONLY_ROLE) {
    throw new Error(
      `DATABASE_URL_RO must connect as ${READONLY_ROLE}. Generated SQL never runs as a role that can write.`,
    );
  }

  pool = new Pool({
    connectionString,
    max: POOL_MAX,
    // Startup parameters rather than SET statements: a connection either
    // carries both settings or fails to open, so no query can ever run on a
    // connection that missed them.
    options: `-c statement_timeout=${STATEMENT_TIMEOUT_MS} -c TimeZone=${SESSION_TIME_ZONE}`,
  });

  // Postgres can drop an idle pooled client, and pg emits that as an 'error'
  // event which terminates the process when nothing is listening. Losing one
  // idle connection must not kill a 500-question run.
  pool.on('error', (error: Error) => {
    console.error(`idle ${READONLY_ROLE} connection dropped: ${error.message}`);
  });

  return pool;
}

function describeError(error: unknown): { code: string | null; message: string } {
  if (error instanceof DatabaseError) return { code: error.code ?? null, message: error.message };
  if (error instanceof Error) return { code: null, message: error.message };
  return { code: null, message: String(error) };
}

// Never throws on a bad query: a Postgres error is an outcome to score and to
// feed back to the model on repair, not an exception for the caller to catch.
export async function executeReadOnly(sql: string): Promise<ExecutionResult> {
  const startedAt = Date.now();
  try {
    const result = await readOnlyPool().query<unknown[]>({ text: sql, rowMode: 'array' });
    return {
      ok: true,
      rows: result.rows,
      columns: result.fields.map((field) => field.name),
      ms: Date.now() - startedAt,
    };
  } catch (error: unknown) {
    const { code, message } = describeError(error);
    return { ok: false, errorCode: code, errorMessage: message, ms: Date.now() - startedAt };
  }
}

export async function closeReadOnlyPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
