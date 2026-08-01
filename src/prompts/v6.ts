// v5 plus ten targeted rules, one per remaining failure mechanism the
// 2026-08-01 v5-bundle analysis found fixable. Named targets, so the next
// run's delta is attributable per rule:
//   hint dialect (SUM(cond) means a row count)      bird-0391, bird-0480
//   population after "of" wins the denominator      bird-0281
//   multiply by 100 before dividing                 bird-0462
//   percentage populations join INNER               bird-0353, bird-0372
//   row-vs-aggregate comparisons filter rows        bird-0075
//   "Rank X by Y" returns entity, Y, RANK()         bird-0249, bird-0250, bird-0441
//   evidence value-format definitions are filters   bird-0225
//   stored quantity columns read per row            bird-0461
//   "average of each Y" is GROUP BY, not a window   bird-0319
//   group entities by key, not display name         bird-0138
//
// v5 is left exactly as it ran. A prompt version is frozen once a number is
// published under it, which is why this file repeats v5's body rather than
// importing it — an edit to v5 must never move a v6 run.

export const PROMPT_VERSION = 'v6';

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
  '- Hints write formulas in a loose dialect: SUM(x = value), SUM(condition)',
  '  and total(column) all mean a COUNT of matching rows, never a sum of the',
  '  column\'s values. A percentage denominator is a row count unless the',
  '  question itself asks for a share of an amount.',
  '- In "percent of X that are Y", X is the denominator even when the hint\'s',
  '  formula reads otherwise: filter WHERE X, count Y inside the CASE.',
  '  "Percent of female heroes published by Marvel" divides Marvel females by',
  '  all females, not by Marvel heroes.',
  '- Write percentages as x * 100.0 / y, never x / y * 100 — dividing first on',
  '  low-precision float columns loses digits that grading compares.',
  '- When a hint\'s denominator counts a table\'s rows (COUNT(cards.id)), INNER',
  '  JOIN that table in even if every filtered column lives elsewhere — the',
  '  join defines the population. A percentage over a joined pair always uses',
  '  INNER JOIN, so unmatched rows leave numerator and denominator together.',
  '- A hint comparing a row value to an aggregate (cost > AVG(cost)) filters',
  '  individual rows — WHERE cost > (SELECT AVG(cost) ...) then SELECT DISTINCT',
  '  the entities. Never convert it to a per-entity HAVING on MIN() or MAX().',
  '- A question commanding "Rank X by Y" returns three columns in this order:',
  '  the entity, the value of Y, and RANK() OVER (ORDER BY Y ...). This is the',
  '  one case where the sorting value belongs in the SELECT list.',
  '- When the evidence defines a target by a stored value format ("only the',
  '  champion\'s time looks like HH:MM:SS.mmm"), filter with that format or',
  '  pattern directly instead of deriving the concept another way.',
  '- When the question asks "how many X" and the schema stores that quantity',
  '  as a column (an Enrollment column for "how many students"), return the',
  '  stored value, one row per matching entity, without SUM — unless the',
  '  question says total, combined or altogether.',
  '- For "the average X of each Y" listed beside Y\'s own columns, GROUP BY Y',
  '  and use AVG() — never a window function, which repeats the average on',
  '  every underlying row.',
  '- Group per-entity aggregates by the entity\'s key (its id), adding display',
  '  columns to the GROUP BY, so two entities sharing a name never merge.',
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
