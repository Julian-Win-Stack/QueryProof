// Phase 6b — the no-LLM picker. Match question words against table and column
// names, send the 10 best-scoring tables (D6). It costs nothing to run, so it
// is the bar the LLM picker has to clear; its known weakness is meaning —
// "pay in EUR" shares no spelling with a column called Currency, and no amount
// of token matching fixes that.
//
// The picker sees the question only, never BIRD's evidence hint (D20).

import type { Table } from '../schema.ts';

// D6: most gold queries touch 1–4 tables (measured: never more than 4), so 10
// leaves margin for a near-miss without the 75-table token bill.
export const PICKER_TABLE_CAP = 10;

export function keywordPick(question: string, tables: Table[]): Table[] {
  const questionTokens = [...new Set(words(question))];

  const scored = tables.map((table) => {
    const bag = new Set([
      ...words(table.name),
      ...table.columns.flatMap((column) => words(column.name)),
    ]);
    return { table, score: scoreAgainst(questionTokens, bag) };
  });

  // Ties and the fill both break alphabetically, so the same question always
  // sends the same tables — a picker with moods would make the bake-off
  // partly measure the picker's mood.
  scored.sort((a, b) => b.score - a.score || a.table.name.localeCompare(b.table.name));

  return scored.slice(0, PICKER_TABLE_CAP).map((entry) => entry.table);
}

function scoreAgainst(questionTokens: string[], bag: Set<string>): number {
  let score = 0;
  for (const token of questionTokens) {
    if (bag.has(token)) {
      score += 2;
    } else if (token.length >= 4 && containsEitherWay(token, bag)) {
      // "races" in the question still credits the race table, and "post"
      // still credits posthistory — one point, so an exact match outranks it.
      score += 1;
    }
  }
  return score;
}

function containsEitherWay(token: string, bag: Set<string>): boolean {
  for (const word of bag) {
    if (word.length >= 4 && (word.includes(token) || token.includes(word))) return true;
  }
  return false;
}

// "Examination Date" -> examination, date; driverRef -> driver, ref. Postgres
// lowercased the table names on load, so posthistory stays one word — the
// containment rule above is what lets "post" reach it.
function words(identifier: string): string[] {
  return identifier
    .split(/[^A-Za-z0-9]+/)
    .flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])/))
    .map((part) => part.toLowerCase())
    .filter((part) => part.length >= 2);
}
