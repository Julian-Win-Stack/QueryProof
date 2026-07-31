// Phase 6a — table recall: did the set of tables sent to the model contain
// every table the gold query needs? All-or-nothing, no partial credit (D7).
//
// The needed tables are parsed out of the gold SQL by regex. The failure mode
// of a text extractor is finding nothing, and finding nothing reads as a hit —
// "is every table in an empty list present" is vacuously true — so a broken
// extractor scores 100% recall forever. Two guards make that impossible: every
// extracted name must exist in the table catalog or this throws, and a query
// that contains FROM but yields zero tables throws.

const IDENTIFIER = String.raw`"[^"]+"|[A-Za-z_][A-Za-z0-9_]*`;

const TABLE_AFTER_FROM_OR_JOIN = new RegExp(String.raw`\b(?:from|join)\s+(${IDENTIFIER})`, 'gi');

// A CTE is the only place an identifier is followed by AS ( — a derived table's
// alias comes after the closing paren, and CAST(x AS numeric(...)) puts the
// identifier after the AS, not before it.
const CTE_NAME = new RegExp(String.raw`\b(${IDENTIFIER})\s+as\s*\(`, 'gi');

// EXTRACT(YEAR FROM x) uses FROM as function syntax — the x is a column, and
// left alone it would be read as a table name. SUBSTRING(s FROM 2) needs no
// handling because a number cannot match an identifier.
const EXTRACT_FROM = new RegExp(String.raw`(\bextract\s*\(\s*\w+\s+)from\b`, 'gi');

// 'it''s' — a doubled quote is an escaped quote, not the end of the literal.
const STRING_LITERAL = /'(?:[^']|'')*'/g;

// Gold SQL spells tables the way BIRD had them (FROM Patient); Postgres folds
// unquoted identifiers to lowercase, so the extractor folds the same way.
// A quoted identifier is taken exactly as written.
function normalize(identifier: string): string {
  if (identifier.startsWith('"')) return identifier.slice(1, -1).replaceAll('""', '"');
  return identifier.toLowerCase();
}

export function extractGoldTables(sql: string, catalogNames: ReadonlySet<string>): string[] {
  // 57 of the 500 gold queries carry "from" or "join" inside a string literal.
  const stripped = sql.replace(STRING_LITERAL, "''").replace(EXTRACT_FROM, '$1');

  const cteNames = new Set(
    [...stripped.matchAll(CTE_NAME)].map((match) => normalize(match[1])),
  );

  const tables = new Set<string>();
  for (const match of stripped.matchAll(TABLE_AFTER_FROM_OR_JOIN)) {
    const name = normalize(match[1]);
    if (cteNames.has(name)) continue;
    if (!catalogNames.has(name)) {
      throw new Error(
        `table recall extractor found "${name}", which is not in the catalog — the extractor is confused, fix it before trusting any recall number. SQL: ${sql.slice(0, 200)}`,
      );
    }
    tables.add(name);
  }

  if (tables.size === 0 && /\bfrom\b/i.test(stripped)) {
    throw new Error(
      `table recall extractor found no tables in a query that has a FROM — a silent empty result would score as a hit. SQL: ${sql.slice(0, 200)}`,
    );
  }

  return [...tables];
}

export function recallHit(neededTables: string[], sentTables: string[]): boolean {
  const sent = new Set(sentTables);
  return neededTables.every((table) => sent.has(table));
}
