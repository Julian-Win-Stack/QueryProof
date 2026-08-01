// picker-v3 — picker-v1 plus the BIRD evidence hint in the message. D20 kept
// evidence out of the picker so the first recall number measured the picker
// alone, and reserved evidence-in as a later measured experiment; this is that
// experiment. The system rules are byte-identical to picker-v1 — a frozen copy,
// not an import, so a later v1 edit cannot silently change what this version
// measured.

export const PICKER_PROMPT_VERSION = 'picker-v3';

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

export function buildPickerMessage(params: {
  question: string;
  catalogText: string;
  evidence?: string;
}): string {
  const sections = [`Tables:\n\n${params.catalogText}`, `Question:\n\n${params.question}`];
  // "Hint" is what the SQL prompt calls the evidence — same word, same meaning.
  if (params.evidence !== undefined && params.evidence.trim() !== '') {
    sections.push(`Hint:\n\n${params.evidence}`);
  }
  return sections.join('\n\n---\n\n');
}
