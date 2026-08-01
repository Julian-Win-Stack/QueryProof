// Prompts for the two post-execution checks (CHECK=probe | self). Versioned
// like every other prompt: the moment a check run's number moves, the first
// question is whether the prompt moved it.

export const CHECK_PROMPT_VERSION = 'check-v1';

// Shared with the generation prompt's rules on purpose — the corrected query
// must obey the same contract the first one did.
const SQL_RULES = [
  'Rules:',
  '- Use only the tables and columns in the schema given. Never invent either.',
  '- Copy identifiers exactly as the schema spells them, including misspellings,',
  '  capitals and spaces, and keep the double quotes around them.',
  '- Return one statement. No trailing semicolon, no comments, no explanation.',
  '- SELECT only. The query runs as a role that cannot write.',
].join('\n');

export const PROBE_SYSTEM = [
  'A PostgreSQL SELECT query written to answer a question returned zero rows,',
  'which is probably wrong. Write ONE exploratory SELECT query to find out why',
  '— for example, list the distinct values of a column the query filters on,',
  'to check the spelling or casing the data actually uses.',
  '',
  SQL_RULES,
].join('\n');

export function buildProbeMessage(params: {
  question: string;
  evidence: string;
  schemaText: string;
  sql: string;
}): string {
  const sections = [`Schema:\n\n${params.schemaText}`];
  if (params.evidence.trim() !== '') sections.push(`Hint:\n\n${params.evidence}`);
  sections.push(`Question:\n\n${params.question}`);
  sections.push(`This query returned zero rows:\n\n${params.sql}`);
  return sections.join('\n\n---\n\n');
}

export const PROBE_REWRITE_SYSTEM = [
  'You write a single PostgreSQL SELECT query answering the user question.',
  'Your first attempt returned zero rows. You then ran an exploratory query;',
  'its result is included. Use what it shows to write a corrected query.',
  '',
  SQL_RULES,
].join('\n');

export function buildProbeRewriteMessage(params: {
  question: string;
  evidence: string;
  schemaText: string;
  sql: string;
  probeSql: string;
  probeResultText: string;
}): string {
  const sections = [`Schema:\n\n${params.schemaText}`];
  if (params.evidence.trim() !== '') sections.push(`Hint:\n\n${params.evidence}`);
  sections.push(`Question:\n\n${params.question}`);
  sections.push(`Your first attempt returned zero rows:\n\n${params.sql}`);
  sections.push(`Your exploratory query:\n\n${params.probeSql}\n\nreturned:\n\n${params.probeResultText}`);
  sections.push('Write the corrected final query answering the question.');
  return sections.join('\n\n---\n\n');
}

export const SELF_CHECK_SYSTEM = [
  'You wrote a PostgreSQL SELECT query to answer a question. The query ran;',
  'its result is included. Judge whether the result actually answers the',
  'question. If it does, return the query unchanged. If it does not, return a',
  'corrected query.',
  '',
  SQL_RULES,
].join('\n');

export function buildSelfCheckMessage(params: {
  question: string;
  evidence: string;
  schemaText: string;
  sql: string;
  resultText: string;
}): string {
  const sections = [`Schema:\n\n${params.schemaText}`];
  if (params.evidence.trim() !== '') sections.push(`Hint:\n\n${params.evidence}`);
  sections.push(`Question:\n\n${params.question}`);
  sections.push(`Your query:\n\n${params.sql}\n\nreturned:\n\n${params.resultText}`);
  sections.push(
    'Does this result answer the question? Return the same query to confirm, or a corrected query.',
  );
  return sections.join('\n\n---\n\n');
}

const MAX_PREVIEW_ROWS = 20;
const MAX_PREVIEW_CELL_LENGTH = 60;

// What the model sees of an executed result. Column names are included here —
// the *grader* never consults them, but the model judging its own answer may.
export function formatResultPreview(rows: unknown[][], columns: string[]): string {
  const shown = rows.slice(0, MAX_PREVIEW_ROWS);
  const lines = shown.map(
    (row) => `(${row.map((cell) => formatPreviewCell(cell)).join(', ')})`,
  );
  const header = `columns: ${columns.join(', ')}\n${rows.length} row${rows.length === 1 ? '' : 's'}`;
  if (rows.length === 0) return header;
  const truncationNote =
    rows.length > MAX_PREVIEW_ROWS ? `\n... (${rows.length - MAX_PREVIEW_ROWS} more rows)` : '';
  return `${header}\n${lines.join('\n')}${truncationNote}`;
}

function formatPreviewCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  return text.length > MAX_PREVIEW_CELL_LENGTH ? `${text.slice(0, MAX_PREVIEW_CELL_LENGTH)}…` : text;
}
