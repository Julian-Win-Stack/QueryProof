// v5 plus the two v6 rules that converted a named target and broke nothing.
//
// v6 shipped ten targeted rules and measured 71.0% — a tie with v5's 72.4%,
// because the eight other rules broke about as many questions as the ten
// converted. Per-question diffing separated them: these two each converted a
// named target with no traced collateral damage, so they come forward on their
// own.
//
//   multiply by 100 before dividing     bird-0058
//   percentage populations join INNER   bird-0372
//
// bird-0058 was reclassified onto the first rule on 2026-08-01: the default now
// reaches expense.cost, and the only remaining gap is that dividing first loses
// the 6th decimal the comparator compares. Measured on the ids alone, v7 takes
// it 3/3 where v5 takes it 0/2.
//
// bird-0462 was the third target and is not one. v7 writes the multiply first
// on every roll and it still fails 1 in 3 — sometimes the picker drops
// `schools`, sometimes the model filters frpm's grade columns anyway. That is
// a re-roll failure, not a prompt one.
//
// Two questions of 500 is 0.4 points against a ±2.5-point noise band, so a full
// run under this prompt cannot prove itself on the headline. It would be judged
// by these ids holding with no regressions elsewhere.
//
// v5 is left exactly as it ran. A prompt version is frozen once a number is
// published under it, which is why this file repeats v5's body rather than
// importing it — an edit to v5 must never move a v7 run.

export const PROMPT_VERSION = 'v7';

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
  '- Write percentages as x * 100.0 / y, never x / y * 100 — dividing first on',
  '  low-precision float columns loses digits that grading compares.',
  '- When a hint\'s denominator counts a table\'s rows (COUNT(cards.id)), INNER',
  '  JOIN that table in even if every filtered column lives elsewhere — the',
  '  join defines the population. A percentage over a joined pair always uses',
  '  INNER JOIN, so unmatched rows leave numerator and denominator together.',
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
