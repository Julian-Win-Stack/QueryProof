// v4 plus three aggregation-shape rules. One prompt change per batch, so the
// delta is attributable.
//
// Why: after Batch G and the cluster-1 union, the remaining winnable failures
// cluster around how the answer is aggregated, not which tables it reads.
// The three rules match the three crisp clusters (2026-08-01 analysis):
//   percentage — 8 questions build the fraction over the wrong population or
//     swap numerator and denominator; gold always uses one pattern
//     (conditional count over the joined population, ×100).
//   formula — 3 questions ignore a formula the hint spells out, substituting
//     AVG() or a same-named stored column whose values differ from computing it.
//   grain — 2 questions aggregate at the wrong unit ("highest monthly X" from
//     single rows) or return the cohort instead of the one-row aggregate.
//
// v4 is left exactly as it ran. A prompt version is frozen once a number is
// published under it, which is why this file repeats v4's body rather than
// importing it — an edit to v4 must never move a v5 run.

export const PROMPT_VERSION = 'v5';

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
  '- When the question asks what percent, percentage, ratio or proportion of a',
  '  population satisfies a condition: keep the whole population in the query,',
  '  count the condition with CASE or FILTER, and divide by the count of that',
  '  same population — never move the condition into WHERE, which shrinks the',
  '  denominator to the numerator. Percent of X that are Y = (X that are Y)',
  '  divided by (all X). When the question or hint says "percentage", multiply',
  '  by 100.',
  '- When the hint spells a formula (DIVIDE(A, B), SUM(x) / COUNT(y)), compute',
  '  exactly that formula. Never replace it with AVG(), and never substitute a',
  '  stored column whose name matches what the formula computes.',
  '- Aggregate at the unit the question names: "highest monthly total" groups',
  '  by month and takes the top month, not the top single row. A question',
  '  asking for one average, total or count over a group returns exactly one',
  '  row, not a row per member.',
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
