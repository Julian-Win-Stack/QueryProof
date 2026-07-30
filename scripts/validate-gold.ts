import { readFileSync, writeFileSync } from 'node:fs';
import { Client, DatabaseError } from 'pg';

const GOLD_PATH = 'data/minidev/MINIDEV/mini_dev_postgresql.json';
const STATEMENT_TIMEOUT_MS = 15_000;
const OUTPUT_DIR = 'gold';

// Every timestamptz literal in BIRD_dev.sql carries a +08 offset, so a naive
// timestamp literal in gold SQL only matches under that zone. Named zone, not
// '+08' — Postgres reads the POSIX form with the sign inverted. See KNOWN_ISSUES.md.
const SESSION_TIME_ZONE = 'Asia/Shanghai';

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

function describeError(error: unknown): { code: string | null; message: string } {
  if (error instanceof DatabaseError) return { code: error.code ?? null, message: error.message };
  if (error instanceof Error) return { code: null, message: error.message };
  return { code: null, message: String(error) };
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Add it to .env — see CLAUDE.md for the expected value.');
  }

  const goldRecords: GoldRecord[] = JSON.parse(readFileSync(GOLD_PATH, 'utf8'));

  const client = new Client({ connectionString });
  await client.connect();
  await client.query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
  await client.query(`SET TimeZone = '${SESSION_TIME_ZONE}'`);

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
