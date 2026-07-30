// The schema text every prompt is built from, read from the live database.
//
// dev_tables.json spells 17 of the 75 table names the way BIRD had them before
// the load — Player_Attributes, lapTimes, postHistory — and Postgres has them
// lowercased. A prompt built from that file names tables that do not exist, and
// the failures read as bad SQL rather than as a bad prompt (D5).

import { readFileSync } from 'node:fs';

import { Client } from 'pg';

// See KNOWN_ISSUES.md. Irrelevant to catalog metadata, but the rule that every
// connection carries it is only true if it has no exceptions.
const SESSION_TIME_ZONE = 'Asia/Shanghai';

const DEV_TABLES_PATH = new URL('../data/minidev/MINIDEV/dev_tables.json', import.meta.url);

export type Column = { name: string; type: string; nullable: boolean };
export type ForeignKey = { column: string; refTable: string; refColumn: string };
export type Table = {
  name: string;
  columns: Column[];
  primaryKey: string[];
  foreignKeys: ForeignKey[];
};

// format_type gives the type as a DDL author would write it — timestamptz,
// numeric(10,2) — where information_schema.data_type spells it out longhand and
// drops the precision into a separate column.
const COLUMNS_SQL = `
  SELECT c.relname AS table_name,
         a.attname AS column_name,
         format_type(a.atttypid, a.atttypmod) AS type,
         NOT a.attnotnull AS nullable
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND a.attnum > 0
    AND NOT a.attisdropped
  ORDER BY c.relname, a.attnum
`;

// Four of the 68 primary keys span several columns, so conkey order is the
// key's column order and has to survive into the rendered text.
const PRIMARY_KEYS_SQL = `
  SELECT c.relname AS table_name, a.attname AS column_name
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
  WHERE n.nspname = 'public' AND con.contype = 'p'
  ORDER BY c.relname, k.ord
`;

// conkey[1] holds for all 87 foreign keys here because every one is
// single-column; column_count comes back so that stops being an assumption.
const FOREIGN_KEYS_SQL = `
  SELECT c.relname AS table_name,
         a.attname AS column_name,
         rc.relname AS ref_table,
         ra.attname AS ref_column,
         array_length(con.conkey, 1) AS column_count
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_class rc ON rc.oid = con.confrelid
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
  JOIN pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = con.confkey[1]
  WHERE n.nspname = 'public' AND con.contype = 'f'
  ORDER BY c.relname, a.attname, rc.relname
`;

type ColumnRow = { table_name: string; column_name: string; type: string; nullable: boolean };
type PrimaryKeyRow = { table_name: string; column_name: string };
type ForeignKeyRow = {
  table_name: string;
  column_name: string;
  ref_table: string;
  ref_column: string;
  column_count: number;
};

// Object rows, not the rowMode: 'array' the rest of the project uses. That rule
// exists so the comparator cannot consult column names; here the column names
// are the data.
export async function loadSchema(): Promise<Table[]> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set — see CLAUDE.md.');

  const client = new Client({ connectionString, options: `-c TimeZone=${SESSION_TIME_ZONE}` });
  await client.connect();

  try {
    const columns = await client.query<ColumnRow>(COLUMNS_SQL);
    const primaryKeys = await client.query<PrimaryKeyRow>(PRIMARY_KEYS_SQL);
    const foreignKeys = await client.query<ForeignKeyRow>(FOREIGN_KEYS_SQL);

    const tables = new Map<string, Table>();

    for (const row of columns.rows) {
      let table = tables.get(row.table_name);
      if (!table) {
        table = { name: row.table_name, columns: [], primaryKey: [], foreignKeys: [] };
        tables.set(row.table_name, table);
      }
      table.columns.push({ name: row.column_name, type: row.type, nullable: row.nullable });
    }

    for (const row of primaryKeys.rows) {
      tableOrThrow(tables, row.table_name).primaryKey.push(row.column_name);
    }

    for (const row of foreignKeys.rows) {
      if (row.column_count !== 1) {
        throw new Error(
          `${row.table_name}.${row.column_name} is part of a ${row.column_count}-column foreign key, which this loader renders as if it were one column`,
        );
      }
      tableOrThrow(tables, row.table_name).foreignKeys.push({
        column: row.column_name,
        refTable: row.ref_table,
        refColumn: row.ref_column,
      });
    }

    return [...tables.values()];
  } finally {
    await client.end();
  }
}

function tableOrThrow(tables: Map<string, Table>, name: string): Table {
  const table = tables.get(name);
  if (!table) throw new Error(`constraint names table "${name}", which has no columns`);
  return table;
}

// Takes tables already chosen: EASY passes a db_id's tables, the baseline passes
// all 75, a picker passes its shortlist. Selection is what Part IV measures, so
// it stays in the caller rather than branching in here.
export function renderSchema(tables: Table[]): string {
  return tables.map(renderTable).join('\n\n');
}

function renderTable(table: Table): string {
  const lines = table.columns.map(
    (column) => `  ${quote(column.name)} ${column.type}${column.nullable ? '' : ' NOT NULL'}`,
  );

  if (table.primaryKey.length > 0) {
    lines.push(`  PRIMARY KEY (${table.primaryKey.map(quote).join(', ')})`);
  }

  for (const foreignKey of table.foreignKeys) {
    lines.push(
      `  FOREIGN KEY (${quote(foreignKey.column)}) REFERENCES ${quote(foreignKey.refTable)} (${quote(foreignKey.refColumn)})`,
    );
  }

  return `CREATE TABLE ${quote(table.name)} (\n${lines.join(',\n')}\n);`;
}

// Always quoted, never conditionally: "order" is a reserved word, "aCL IgG"
// carries a space and a capital, and deciding per identifier would mean keeping
// a reserved-word list correct.
function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

// EASY mode only. HARD mode never calls this — not being allowed to read
// dev_tables.json is what makes it hard.
export function tablesForDbId(dbId: string, tables: Table[]): Table[] {
  const byLowercaseName = new Map(tables.map((table) => [table.name.toLowerCase(), table]));

  return devTableNames(dbId).map((name) => {
    const table = byLowercaseName.get(name.toLowerCase());
    if (!table) {
      throw new Error(`dev_tables.json lists "${name}" under db_id "${dbId}", which is not a table`);
    }
    return table;
  });
}

type DevTablesEntry = { db_id: string; table_names_original: string[] };

let devTables: Map<string, string[]> | undefined;

function devTableNames(dbId: string): string[] {
  devTables ??= readDevTables();
  const names = devTables.get(dbId);
  if (!names) throw new Error(`db_id "${dbId}" is not in dev_tables.json`);
  return names;
}

function readDevTables(): Map<string, string[]> {
  const parsed: unknown = JSON.parse(readFileSync(DEV_TABLES_PATH, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${DEV_TABLES_PATH.pathname} is not a JSON array — regenerate data/`);
  }

  const entries = parsed as DevTablesEntry[];
  return new Map(entries.map((entry) => [entry.db_id, entry.table_names_original]));
}
