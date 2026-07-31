// The first prompt. Deliberately plain — it is the baseline every later version
// is measured against, not a tuned artifact.
//
// The version string ships from the first run rather than from the day the
// prompt first changes: the moment accuracy moves, the first question is whether
// the prompt or the noise moved it, and only a recorded version answers that.
// Added later, every earlier run is unlabelled.

export const PROMPT_VERSION = 'v1';

export const SYSTEM = [
  'You write a single PostgreSQL SELECT query answering the user question.',
  '',
  'Rules:',
  '- Use only the tables and columns in the schema given. Never invent either.',
  '- Copy identifiers exactly as the schema spells them, including misspellings,',
  '  capitals and spaces, and keep the double quotes around them.',
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
