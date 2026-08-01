// picker-v4 — Julian's iteration on picker-v3's stage-1 result, three changes
// bundled by his call (attribution is deliberately bundled, unlike Batch E):
//   1. "Fewer is better when you are confident" removed.
//   2. The hint's column names must pull in their owning tables — stage 1
//      showed the model reads "cost" in the hint and still does not look up
//      which table has a cost column (9 of 16 targets stayed missed).
//   3. The hint is not the whole table list — stage 1 showed evidence
//      narrowing the pick, dropping middle tables the hint never names
//      (12 hit->miss regressions).
// Message shape is picker-v3's: catalog, question, then the hint.

export const PICKER_PROMPT_VERSION = 'picker-v4';

export const PICKER_SYSTEM = [
  'You select which database tables are needed to answer a question.',
  '',
  'You are given every table in the database, one per line, as',
  'table_name: column, column, ...',
  '',
  'The question comes with a hint that maps its words to column names and',
  'stored values. Use it:',
  '- Include every table that has a column the hint names. Scan the catalog',
  '  for the owner of each named column.',
  '- The hint does not name every table the query needs. Beyond the tables',
  '  the hint points at, include the join tables and any table needed to',
  '  connect or filter them — a missing table makes the query impossible.',
  '',
  'Rules:',
  '- Return only table names from the list, spelled exactly as given.',
  '- Return every table the query will need, including join tables.',
  '- Return at most 10 tables.',
  '- Table names alone can mislead — similarly named tables may belong to',
  '  unrelated domains, so judge by the columns, not the name.',
].join('\n');

export function buildPickerMessage(params: {
  question: string;
  catalogText: string;
  evidence?: string;
}): string {
  const sections = [`Tables:\n\n${params.catalogText}`, `Question:\n\n${params.question}`];
  if (params.evidence !== undefined && params.evidence.trim() !== '') {
    sections.push(`Hint:\n\n${params.evidence}`);
  }
  return sections.join('\n\n---\n\n');
}
