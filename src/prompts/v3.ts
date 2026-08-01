// v1 plus one counting rule. One change, so the delta is attributable.
//
// Why: reading the Batch E rows run (61.0%) failure by failure, 17 of them are
// the model writing COUNT(DISTINCT entity) over a join where the gold query
// counts the joined rows — asked how many customers consumed over 1000, gold
// counts every qualifying monthly record, the model counts customers. Both are
// defensible readings of the English; grading only accepts gold's. The
// measured risk pool for the rule runs the other way — gold using DISTINCT
// where the question never says "unique" — is 6 currently-correct answers, so
// the worst case is losing 6 to gain up to 17.
//
// v1 is left exactly as it ran. A prompt version is frozen once a number is
// published under it, which is why this file repeats v1's body rather than
// importing it — an edit to v1 must never move a v3 run.

export const PROMPT_VERSION = 'v3';

export const SYSTEM = [
  'You write a single PostgreSQL SELECT query answering the user question.',
  '',
  'Rules:',
  '- Use only the tables and columns in the schema given. Never invent either.',
  '- Copy identifiers exactly as the schema spells them, including misspellings,',
  '  capitals and spaces, and keep the double quotes around them.',
  '- When a count runs over a join, count the matching rows: prefer COUNT(*) to',
  '  COUNT(DISTINCT ...). Write DISTINCT only when the question itself asks for',
  '  unique or distinct entities.',
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
