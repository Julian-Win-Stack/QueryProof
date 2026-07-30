// Phase 4b's exit test. One question, end to end: schema text in, SQL out, rows
// back. No grading — that is Phase 5.
//
//   npx tsx --env-file-if-exists=.env scripts/ask.ts "How many customers pay in EUR?"
//   npx tsx --env-file-if-exists=.env scripts/ask.ts "..." debit_card_specializing
//
// With a db_id it runs EASY mode, the configuration Phase 5 measures. Without
// one it sends all 75 tables, which is Phase 6d's baseline.

import { generateSql } from '../src/generate-sql.ts';
import { closeReadOnlyPool, executeReadOnly } from '../src/execute-readonly.ts';
import { EFFORT, MODEL, usdCost } from '../src/model.ts';
import { loadSchema, renderSchema, tablesForDbId } from '../src/schema.ts';

const MAX_PRINTED_ROWS = 20;

async function main(): Promise<void> {
  const [question, dbId] = process.argv.slice(2);
  if (!question) {
    throw new Error('usage: ask.ts "<question>" [db_id]');
  }

  const allTables = await loadSchema();
  const tables = dbId ? tablesForDbId(dbId, allTables) : allTables;

  console.log(`model:  ${MODEL}  effort: ${EFFORT}`);
  console.log(`tables: ${tables.length}${dbId ? ` (db_id ${dbId})` : ' (all)'}`);
  console.log('');

  const generated = await generateSql({
    question,
    // No BIRD record here, so no hint. The eval harness passes the real one.
    evidence: '',
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
