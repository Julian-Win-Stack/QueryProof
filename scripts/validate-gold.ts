import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Client, DatabaseError, type FieldDef } from 'pg';

const CONNECTION_STRING = 'postgresql://postgres:devpass@localhost:5433/bird';
const GOLD_PATH = 'data/minidev/MINIDEV/mini_dev_postgresql.json';
const STATEMENT_TIMEOUT_MS = 15_000;
const OUTPUT_DIR = 'gold';

type GoldRecord = {
  question_id: number;
  db_id: string;
  question: string;
  evidence: string;
  SQL: string;
  difficulty: string;
};

type ExecutedRecord = {
  id: string;
  db_id: string;
  difficulty: string;
  question: string;
  evidence: string;
  sql: string;
  rowCount: number;
  columns: string[];
  resultHash: string;
  ms: number;
};

type RejectedRecord = {
  id: string;
  db_id: string;
  difficulty: string;
  question: string;
  evidence: string;
  sql: string;
  errorCode: string | null;
  errorMessage: string;
  ms: number;
};

/**
 * resultHash exists to detect gold drift (schema reload, data reload), never to grade
 * candidate SQL. Two correct queries can order rows or columns differently, so the hash
 * is taken over a canonical form: columns sorted by name, rows sorted as text, floats
 * rounded to 6 decimals, nulls given a sentinel no string value can collide with.
 */
function canonicalValue(value: unknown): string {
  if (value === null || value === undefined) return '\u0000null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    // Only float8/float4 arrive as JS numbers; numeric arrives as an exact string, so
    // rounding here targets binary float noise without mangling text like '01234'.
    return Number.isInteger(value) ? String(value) : value.toFixed(6);
  }
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('hex');
  return JSON.stringify(value);
}

function hashResult(fields: FieldDef[], rows: unknown[][]): string {
  // Duplicate column names are legal in a result set, so ties break on original position.
  const sortedFields = fields
    .map((field, position) => ({ name: field.name, position }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.position - b.position);

  const canonicalRows = rows
    .map((row) => sortedFields.map((field) => canonicalValue(row[field.position])).join('\u0001'))
    .sort();

  return createHash('sha256')
    .update(sortedFields.map((field) => field.name).join('\u0001'))
    .update('\u0002')
    .update(canonicalRows.join('\n'))
    .digest('hex');
}

function describeError(error: unknown): { code: string | null; message: string } {
  if (error instanceof DatabaseError) return { code: error.code ?? null, message: error.message };
  if (error instanceof Error) return { code: null, message: error.message };
  return { code: null, message: String(error) };
}

async function main(): Promise<void> {
  const goldRecords: GoldRecord[] = JSON.parse(readFileSync(GOLD_PATH, 'utf8'));

  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  await client.query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`);

  const validated: ExecutedRecord[] = [];
  const quarantined: ExecutedRecord[] = [];
  const rejected: RejectedRecord[] = [];

  for (const [index, record] of goldRecords.entries()) {
    const identity = {
      id: `bird-${String(index).padStart(4, '0')}`,
      db_id: record.db_id,
      difficulty: record.difficulty,
      question: record.question,
      evidence: record.evidence,
      sql: record.SQL,
    };
    const startedAt = Date.now();

    try {
      const result = await client.query<unknown[]>({ text: record.SQL, rowMode: 'array' });
      const executed: ExecutedRecord = {
        ...identity,
        rowCount: result.rows.length,
        columns: result.fields.map((field) => field.name),
        resultHash: hashResult(result.fields, result.rows),
        ms: Date.now() - startedAt,
      };
      if (result.rows.length === 0) {
        quarantined.push(executed);
      } else {
        validated.push(executed);
      }
    } catch (error: unknown) {
      const { code, message } = describeError(error);
      rejected.push({ ...identity, errorCode: code, errorMessage: message, ms: Date.now() - startedAt });
    }

    if ((index + 1) % 25 === 0 || index === goldRecords.length - 1) {
      console.log(
        `[${index + 1}/${goldRecords.length}] validated ${validated.length} | rejected ${rejected.length} | quarantined ${quarantined.length}`,
      );
    }
  }

  await client.end();

  writeFileSync(`${OUTPUT_DIR}/validated.json`, JSON.stringify(validated, null, 2));
  writeFileSync(`${OUTPUT_DIR}/rejected.json`, JSON.stringify(rejected, null, 2));
  writeFileSync(`${OUTPUT_DIR}/quarantine.json`, JSON.stringify(quarantined, null, 2));

  console.log('');
  console.log(`validated:   ${validated.length}`);
  console.log(`rejected:    ${rejected.length}`);
  console.log(`quarantined: ${quarantined.length}`);
}

main().catch((error: unknown) => {
  console.error(describeError(error).message);
  process.exit(1);
});
