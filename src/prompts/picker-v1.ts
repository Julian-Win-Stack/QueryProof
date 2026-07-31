// The LLM picker's prompt. Versioned from its first run for the same reason
// the SQL prompt is: the moment recall moves, the first question is whether
// the prompt moved it.
//
// The picker sees table names and column names from the live catalog, nothing
// else (D21) — no BIRD descriptions (that is a deferred measured experiment,
// D5) and no evidence hint (D20).

export const PICKER_PROMPT_VERSION = 'picker-v1';

export const PICKER_SYSTEM = [
  'You select which database tables are needed to answer a question.',
  '',
  'You are given every table in the database, one per line, as',
  'table_name: column, column, ...',
  '',
  'Rules:',
  '- Return only table names from the list, spelled exactly as given.',
  '- Return every table the query will need, including join tables.',
  '- Return at most 10 tables. Fewer is better when you are confident.',
  '- Table names alone can mislead — similarly named tables may belong to',
  '  unrelated domains, so judge by the columns, not the name.',
].join('\n');

export function buildPickerMessage(params: { question: string; catalogText: string }): string {
  return `Tables:\n\n${params.catalogText}\n\n---\n\nQuestion:\n\n${params.question}`;
}
