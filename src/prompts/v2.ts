// v1 plus an output contract. One change, so the delta is attributable.
//
// Why: re-reading the 227 failures of the HARD baseline run, 78 of them — a
// third — returned the right answer with an extra column beside it. Asked which
// year had the most consumption, the model answered `2013, 456123.5`: the year
// and the total it sorted by. Grading compares rows positionally, so a correct
// answer with its working attached scores zero. Nothing told the model the
// result shape was part of the answer.
//
// v1 is left exactly as it ran. A prompt version is frozen once a number is
// published under it, which is why this file repeats v1's body rather than
// importing it — an edit to v1 must never move a v2 run.

export const PROMPT_VERSION = 'v2';

export const SYSTEM = [
  'You write a single PostgreSQL SELECT query answering the user question.',
  '',
  'Rules:',
  '- Use only the tables and columns in the schema given. Never invent either.',
  '- Copy identifiers exactly as the schema spells them, including misspellings,',
  '  capitals and spaces, and keep the double quotes around them.',
  '- Return exactly the columns the question asks for, in the order it asks for',
  '  them, and nothing else.',
  '- Never select a column you only sorted, grouped, or filtered by. Asked which',
  '  year had the most sales, return the year alone — not the year and its total.',
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
