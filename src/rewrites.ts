// Deterministic dialect repairs applied to generated SQL (REWRITE=on). Both
// exist because the gold set is BIRD's Postgres port, which was dialect-patched
// by BIRD's own maintainers — 60 of 500 gold queries carry NULLS LAST that the
// SQLite originals never needed — while the model keeps writing SQLite-idiom
// SQL. The asymmetry is the harness's, not the model's, so the fix is code
// that always runs, not a prompt rule the model follows unevenly.
//
//   nulls-last  Postgres sorts NULLs FIRST under DESC, SQLite sorts them last.
//               Every ORDER BY x DESC LIMIT 1 used as a max picks a NULL row.
//               Applied before execution, to every DESC not already qualified.
//   text-cast   LIKE on a date/timestamp column works in SQLite and is a hard
//               42883 in Postgres. The error's position field points at the
//               operator; the column just before it gets ::text. Applied only
//               after that exact error, so it can never touch a running query.
//
// Neither rewrite parses SQL. nulls-last tokenizes just enough to skip quoted
// regions; text-cast edits around the character Postgres pointed at.

import { type ExecutionResult } from './execute-readonly.ts';

// Splits SQL into quoted and unquoted segments. Odd-indexed captures are
// '...' literals (with '' escapes) or "..." identifiers and are never edited.
const QUOTED_SEGMENTS = /('(?:[^']|'')*'|"[^"]*")/;

// DESC not already followed by a NULLS qualifier. \b keeps "description" and
// friends safe; quoted regions never reach this regex.
const BARE_DESC = /\b(DESC)\b(?!\s+NULLS\b)/gi;

export function applyNullsLast(sql: string): string {
  return sql
    .split(QUOTED_SEGMENTS)
    .map((segment, index) =>
      index % 2 === 1 ? segment : segment.replace(BARE_DESC, '$1 NULLS LAST'),
    )
    .join('');
}

// "operator does not exist: date ~~ unknown" and its family — ~~ is LIKE,
// ~~* is ILIKE, !~~ is NOT LIKE. Only the date/timestamp-on-the-left shape is
// handled: it has exactly one possible meaning, comparing the text form.
const DATE_LIKE_ERROR =
  /operator does not exist: (?:date|timestamp(?:tz)?(?: with(?:out)? time zone)?) !?~~\*? unknown/;

const OPERATOR_MISMATCH = '42883';

// The identifier chain ending at the error position: a.b, "a"."b", plain b.
// Postgres's position lands on the operator keyword (LIKE / NOT), so the
// column is the last token before it.
const COLUMN_BEFORE_OPERATOR =
  /((?:[A-Za-z_][A-Za-z0-9_$]*|"[^"]+")(?:\.(?:[A-Za-z_][A-Za-z0-9_$]*|"[^"]+"))*)(\s+NOT)?(\s*)$/i;

// Words the regex above could capture that are never the column.
const NOT_A_COLUMN = /^(?:not|and|or|where|on|when|then|else|like|ilike|between|in|is)$/i;

export function applyTextCast(sql: string, execution: ExecutionResult): string | null {
  if (execution.ok) return null;
  if (execution.errorCode !== OPERATOR_MISMATCH) return null;
  if (execution.errorPosition === null) return null;
  if (!DATE_LIKE_ERROR.test(execution.errorMessage)) return null;

  const head = sql.slice(0, execution.errorPosition - 1);
  const tail = sql.slice(execution.errorPosition - 1);

  const match = COLUMN_BEFORE_OPERATOR.exec(head);
  if (match === null) return null;

  const [, column, notKeyword = '', whitespace] = match;
  const lastSegment = column.split('.').at(-1) ?? column;
  if (NOT_A_COLUMN.test(lastSegment)) return null;

  return `${head.slice(0, match.index)}${column}::text${notKeyword}${whitespace}${tail}`;
}
