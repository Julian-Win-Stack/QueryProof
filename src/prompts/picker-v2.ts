// Picker prompt v2 — one rule changed from picker-v1. Full copy rather than an
// import, for the same reason v2.ts repeats v1.ts: picker-v1 is behind the
// README's 86.0% recall, and an edit to v1 must never move a v2 run.
//
// The changed rule: v1 said "Fewer is better when you are confident", and the
// picker obeyed — 2.08 tables sent on average against a cap of 10, with 64 of
// its 70 recall misses short exactly one table. v2 tells it which way to err.

export const PICKER_PROMPT_VERSION = 'picker-v2';

export const PICKER_SYSTEM = [
  'You select which database tables are needed to answer a question.',
  '',
  'You are given every table in the database, one per line, as',
  'table_name: column, column, ...',
  '',
  'Rules:',
  '- Return only table names from the list, spelled exactly as given.',
  '- Return every table the query will need, including join tables.',
  '- Return at most 10 tables. Include every table that might be needed —',
  '  a missing table makes the query impossible, an extra one only costs tokens.',
  '- Table names alone can mislead — similarly named tables may belong to',
  '  unrelated domains, so judge by the columns, not the name.',
].join('\n');

export function buildPickerMessage(params: { question: string; catalogText: string }): string {
  return `Tables:\n\n${params.catalogText}\n\n---\n\nQuestion:\n\n${params.question}`;
}
