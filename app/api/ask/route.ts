// The product path (Phase 8): question in; SQL, rows, attempt count out. The
// configuration is the measured one — llm picker over all 75 tables, repair on.
// No database selector and no hint box (D17): a selector would demo EASY mode,
// and a hint box would hand the visitor BIRD's evidence field, which no real
// user has.

import { answerQuestion } from '../../../src/answer.ts';
import { confidenceOf } from '../../../src/confidence.ts';
import { llmPick } from '../../../src/pickers/llm.ts';
import { loadSchema, renderSchema } from '../../../src/schema.ts';

// The browser payload stays small; the full count is reported next to them.
const MAX_ROWS_RETURNED = 50;

const catalogPromise = loadSchema();

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const question =
    typeof body === 'object' && body !== null && 'question' in body && typeof body.question === 'string'
      ? body.question.trim()
      : '';
  if (question === '') {
    return Response.json({ error: 'Ask a question in plain English.' }, { status: 400 });
  }

  try {
    const catalog = await catalogPromise;
    const picked = await llmPick(question, catalog);

    const answer = await answerQuestion({
      question,
      evidence: '',
      schemaText: renderSchema(picked.tables),
      repair: true,
    });

    if (!answer.execution.ok) {
      return Response.json({
        sql: answer.sql,
        attempts: answer.attempts,
        tables: picked.tables.map((table) => table.name),
        error: `Postgres ${answer.execution.errorCode ?? ''}: ${answer.execution.errorMessage}`,
      });
    }

    return Response.json({
      sql: answer.sql,
      columns: answer.execution.columns,
      rows: answer.execution.rows.slice(0, MAX_ROWS_RETURNED),
      rowCount: answer.execution.rows.length,
      attempts: answer.attempts,
      tables: picked.tables.map((table) => table.name),
      confidence: confidenceOf({ attempts: answer.attempts, rowsReturned: answer.execution.rows.length }),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
