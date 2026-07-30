// Phase 4b's exit test, and the way a single question gets debugged by hand
// afterwards. Schema text in, SQL out, rows back. No grading — that is Phase 5.
//
//   npm run ask -- bird-0000
//   npm run ask -- "How many customers pay in EUR?" debit_card_specializing
//   npm run ask -- "How many customers pay in EUR?"
//
// A gold id is the form to reach for: it sends the record's own evidence and its
// own db_id, so the prompt matches what the eval will send. Typing a question
// instead sends no evidence, which is a different prompt. With a db_id it runs
// EASY mode, the configuration Phase 5 measures; without one it sends all 75
// tables, which is Phase 6d's baseline.

import { readFileSync } from 'node:fs';

import { generateSql } from '../src/generate-sql.ts';
import { closeReadOnlyPool, executeReadOnly } from '../src/execute-readonly.ts';
import { EFFORT, MODEL, usdCost } from '../src/model.ts';
import { loadSchema, renderSchema, tablesForDbId } from '../src/schema.ts';

const MAX_PRINTED_ROWS = 20;

const GOLD_PATH = new URL('../gold/validated.json', import.meta.url);
const GOLD_ID = /^bird-\d{4}$/;

type GoldRecord = { id: string; db_id: string; question: string; evidence: string };
type Asked = { question: string; evidence: string; dbId: string | undefined };

function fromGold(id: string): Asked {
  const parsed: unknown = JSON.parse(readFileSync(GOLD_PATH, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${GOLD_PATH.pathname} is not a JSON array — run npm run validate-gold`);
  }

  const record = (parsed as GoldRecord[]).find((candidate) => candidate.id === id);
  if (!record) throw new Error(`no gold record "${id}"`);

  return { question: record.question, evidence: record.evidence, dbId: record.db_id };
}

async function main(): Promise<void> {
  const [first, second] = process.argv.slice(2);
  if (!first) {
    throw new Error('usage: ask.ts <bird-NNNN> | ask.ts "<question>" [db_id]');
  }

  const asked: Asked = GOLD_ID.test(first)
    ? fromGold(first)
    : { question: first, evidence: '', dbId: second };

  const allTables = await loadSchema();
  const tables = asked.dbId ? tablesForDbId(asked.dbId, allTables) : allTables;

  console.log(`model:  ${MODEL}  effort: ${EFFORT}`);
  console.log(`tables: ${tables.length}${asked.dbId ? ` (db_id ${asked.dbId})` : ' (all)'}`);
  console.log(`hint:   ${asked.evidence.trim() === '' ? 'none' : 'sent'}`);
  console.log(`asking: ${asked.question}`);
  console.log('');

  const generated = await generateSql({
    question: asked.question,
    evidence: asked.evidence,
    schemaText: renderSchema(tables),
  });

  console.log(`SQL (prompt ${generated.promptVersion}):`);
  console.log(generated.sql);
  console.log('');

  const result = await executeReadOnly(generated.sql);

  if (!result.ok) {
    console.log(`Postgres refused it: ${result.errorCode ?? 'no code'} — ${result.errorMessage}`);
  } else {
    console.log(`${result.rows.length} row(s) in ${result.ms}ms:`);
    console.log(result.columns.join(' | '));
    for (const row of result.rows.slice(0, MAX_PRINTED_ROWS)) {
      console.log(row.map((value) => String(value)).join(' | '));
    }
    if (result.rows.length > MAX_PRINTED_ROWS) {
      console.log(`… ${result.rows.length - MAX_PRINTED_ROWS} more`);
    }
  }

  console.log('');
  console.log(
    `tokens: ${generated.usage.promptTokens} in, ${generated.usage.completionTokens} out ` +
      `(${generated.usage.reasoningTokens} reasoning) — $${usdCost(generated.usage).toFixed(4)} in ${generated.ms}ms`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(closeReadOnlyPool);
