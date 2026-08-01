// v1 plus projection discipline. One change, so the delta is attributable.
//
// Why: output shape is the largest failure mode in the rows run (61.0%) — 79
// of its 195 wrong answers returned the wrong NUMBER of columns, and the
// winnable-failures work list puts "wrong columns returned" first at 29 of 99.
// The grader compares column count and position and never names, so an extra
// sort-key column or a helpful id column turns a right answer wrong. v1 says
// nothing at all about what belongs in the SELECT list; these rules are that
// missing paragraph. Distinct from v2 (rejected), which tried to teach the
// gold set's *output conventions* — this only forbids adding what the question
// never asked for.
//
// v1 is left exactly as it ran. A prompt version is frozen once a number is
// published under it, which is why this file repeats v1's body rather than
// importing it — an edit to v1 must never move a v4 run.

export const PROMPT_VERSION = 'v4';

export const SYSTEM = [
  'You write a single PostgreSQL SELECT query answering the user question.',
  '',
  'Rules:',
  '- Use only the tables and columns in the schema given. Never invent either.',
  '- Copy identifiers exactly as the schema spells them, including misspellings,',
  '  capitals and spaces, and keep the double quotes around them.',
  '- SELECT exactly the columns the question asks for, in the order it asks for',
  '  them — nothing more. A value used only to sort, rank or filter belongs in',
  '  ORDER BY or WHERE, never in the SELECT list.',
  '- Never add columns the question did not ask for, even as helpful context —',
  '  no ids, no names, no counts that only justify the answer.',
  '- When the hint lists columns for a phrase ("full name refers to first_name,',
  '  last_name"), return them as separate columns in that order. Never',
  '  concatenate them.',
  '- Return one statement. No trailing semicolon, no comments, no explanation.',
  '- SELECT only. The query runs as a role that cannot write.',
].join('\n');

// One failed try at a question: the SQL and the Postgres error it produced.
// The repair retry sees every one of these, not just the last (D14).
export type FailedAttempt = {
  sql: string;
  errorCode: string | null;
  errorMessage: string;
};

export function buildUserMessage(params: {
  question: string;
  evidence: string;
  schemaText: string;
  failures?: FailedAttempt[];
}): string {
  const sections = [`Schema:\n\n${params.schemaText}`];

  // BIRD ships evidence per question — a hint at the intended reading, e.g.
  // "ratio of EUR to CZK = count(Currency = 'EUR') / count(Currency = 'CZK')".
  // Not every record has one.
  if (params.evidence.trim() !== '') sections.push(`Hint:\n\n${params.evidence}`);

  sections.push(`Question:\n\n${params.question}`);

  if (params.failures !== undefined && params.failures.length > 0) {
    const history = params.failures
      .map(
        (failure, index) =>
          `Attempt ${index + 1}:\n${failure.sql}\n\nPostgres error${failure.errorCode === null ? '' : ` ${failure.errorCode}`}: ${failure.errorMessage}`,
      )
      .join('\n\n');
    sections.push(
      `Your previous ${params.failures.length === 1 ? 'attempt' : 'attempts'} failed to execute. Write a corrected query. Do not repeat a failed attempt.\n\n${history}`,
    );
  }

  return sections.join('\n\n---\n\n');
}
