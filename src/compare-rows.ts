// The grader. Every accuracy number in the README is this function's output.
//
// Four rules: row order ignored, column order significant, column names never
// consulted (structural — the signature takes arrays), duplicates significant.
//
// This is the project's only value canonicalization (D1-D3 in
// docs/decisions.md). A second one anywhere else grades against a different
// definition of "same rows".

const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;
const TIMESTAMP_TEXT = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}:\d{2}))?$/;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

// Local components, never toISOString(): pg parses date and timestamp into
// local-time Date objects, so rendering in UTC would shift every date by the
// machine's offset.
function renderDate(value: Date): string {
  const date = `${pad(value.getFullYear(), 4)}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  const time = `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  if (time === '00:00:00' && value.getMilliseconds() === 0) return date;
  return `${date} ${time}`;
}

// Returns null when the string is not a timestamp, so the caller keeps it as
// text. Midnight collapses to a bare date so TO_CHAR with and without a time
// format land on the same value, as a Date at midnight does.
function canonicalizeTimestampText(value: string): string | null {
  const match = TIMESTAMP_TEXT.exec(value);
  if (!match) return null;
  const [, date, time] = match;
  if (time === undefined || time === '00:00:00') return date;
  return `${date} ${time}`;
}

// A SQL NULL canonicalizes to JS null, which JSON renders unquoted — so it
// cannot collide with the text value 'null'.
function canonicalizeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return renderDate(value);
  // Six decimal places: pg returns integer as a number but bigint and numeric
  // as strings, and two correct aggregation orders drift in the low bits.
  if (typeof value === 'number') return value.toFixed(6);
  if (typeof value === 'string') {
    if (NUMERIC_TEXT.test(value)) return Number(value).toFixed(6);
    return canonicalizeTimestampText(value) ?? value;
  }
  return JSON.stringify(value);
}

// JSON.stringify, not join: no separator a text value could contain.
function canonicalizeRow(row: unknown[]): string {
  return JSON.stringify(row.map(canonicalizeValue));
}

export function compareRows(actual: unknown[][], expected: unknown[][]): boolean {
  if (actual.length !== expected.length) return false;

  const canonicalActual = actual.map(canonicalizeRow).sort();
  const canonicalExpected = expected.map(canonicalizeRow).sort();

  return canonicalActual.every((row, index) => row === canonicalExpected[index]);
}
