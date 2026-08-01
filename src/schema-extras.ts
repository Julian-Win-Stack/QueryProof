// Optional context appended to the schema text — the SQL_CONTEXT and
// PICKER_CONTEXT experiments. Three kinds, each measured on its own:
//
//   rows    five real rows per table, read live
//   values  every distinct value of a text column that holds few enough to list
//   desc    BIRD's shipped database_description CSVs
//
// Everything here is built once per process for the whole catalog; renderSchema
// and the picker then look up only the tables they were given. Data reads go
// through the read-only role like all generated SQL does — this module touches
// the same rows the model's queries will.

import { readdirSync, readFileSync } from 'node:fs';

import { executeReadOnly } from './execute-readonly.ts';
import type { Table } from './schema.ts';

export type SqlContextKind = 'rows' | 'values' | 'desc';
export type PickerContextKind = 'values' | 'desc';

export const SQL_CONTEXT_KINDS: SqlContextKind[] = ['rows', 'values', 'desc'];
export const PICKER_CONTEXT_KINDS: PickerContextKind[] = ['values', 'desc'];

const DEV_DATABASES_DIR = new URL('../data/minidev/MINIDEV/dev_databases/', import.meta.url);

// Above this a value list stops being a list — same threshold the offline
// cost measurement used (~63 tokens per table across the catalog).
const MAX_DISTINCT_VALUES = 20;

const SAMPLE_ROW_COUNT = 5;

// Long free-text cells and descriptions get cut, not shipped whole: the point
// is spelling and shape, and one biography column can outweigh the schema.
const MAX_CELL_LENGTH = 40;
const MAX_DESCRIPTION_LENGTH = 160;

// SQL-prompt rendering: comment lines under each CREATE TABLE block.
export async function buildSqlExtras(
  catalog: Table[],
  kinds: SqlContextKind[],
): Promise<Map<string, string>> {
  const sections = new Map<string, string[]>();
  const add = (tableName: string, lines: string[]): void => {
    if (lines.length === 0) return;
    const existing = sections.get(tableName) ?? [];
    sections.set(tableName, [...existing, ...lines]);
  };

  // Fixed order — rows, values, desc — so a stacked run renders the same text
  // regardless of how the env var spelled the list.
  if (kinds.includes('rows')) {
    const rows = await sampleRows(catalog);
    for (const table of catalog) {
      const tuples = rows.get(table.name) ?? [];
      add(
        table.name,
        tuples.length === 0
          ? []
          : [`-- sample rows (first ${tuples.length}):`, ...tuples.map((tuple) => `--   ${tuple}`)],
      );
    }
  }

  if (kinds.includes('values')) {
    const values = await valueLists(catalog);
    for (const table of catalog) {
      add(
        table.name,
        (values.get(table.name) ?? []).map(
          (entry) =>
            `-- values of "${entry.column}": ${entry.values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ')}`,
        ),
      );
    }
  }

  if (kinds.includes('desc')) {
    const descriptions = loadDescriptions(catalog);
    for (const table of catalog) {
      add(
        table.name,
        (descriptions.get(table.name) ?? []).map((entry) => `-- "${entry.column}": ${entry.text}`),
      );
    }
  }

  return new Map([...sections.entries()].map(([name, lines]) => [name, lines.join('\n')]));
}

// Picker rendering: indented lines under each "table: columns" catalog line.
// Compact on purpose — this text is repeated for all 75 tables per question.
export async function buildPickerExtras(
  catalog: Table[],
  kinds: PickerContextKind[],
): Promise<Map<string, string>> {
  const sections = new Map<string, string[]>();
  const add = (tableName: string, lines: string[]): void => {
    if (lines.length === 0) return;
    const existing = sections.get(tableName) ?? [];
    sections.set(tableName, [...existing, ...lines]);
  };

  if (kinds.includes('values')) {
    const values = await valueLists(catalog);
    for (const table of catalog) {
      add(
        table.name,
        (values.get(table.name) ?? []).map(
          (entry) => `  values ${entry.column}: ${entry.values.join(' | ')}`,
        ),
      );
    }
  }

  if (kinds.includes('desc')) {
    const descriptions = loadDescriptions(catalog);
    for (const table of catalog) {
      add(
        table.name,
        (descriptions.get(table.name) ?? []).map((entry) => `  ${entry.column}: ${entry.text}`),
      );
    }
  }

  return new Map([...sections.entries()].map(([name, lines]) => [name, lines.join('\n')]));
}

// Every column cast to text so Postgres renders the values — dates and
// timestamps arrive spelled the way a correct literal would spell them under
// the session time zone, instead of as Date objects mangled through UTC.
async function sampleRows(catalog: Table[]): Promise<Map<string, string[]>> {
  const rows = new Map<string, string[]>();
  for (const table of catalog) {
    const selectList = table.columns.map((column) => `"${column.name.replaceAll('"', '""')}"::text`).join(', ');
    const result = await executeReadOnly(
      `SELECT ${selectList} FROM "${table.name.replaceAll('"', '""')}" LIMIT ${SAMPLE_ROW_COUNT}`,
    );
    if (!result.ok) {
      throw new Error(`sampling ${table.name} failed: ${result.errorMessage}`);
    }
    rows.set(
      table.name,
      result.rows.map((row) => `(${row.map((cell) => formatCell(cell)).join(', ')})`),
    );
  }
  return rows;
}

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  const text = String(value);
  if (/^-?\d+(\.\d+)?$/.test(text)) return text;
  const cut = text.length > MAX_CELL_LENGTH ? `${text.slice(0, MAX_CELL_LENGTH)}…` : text;
  return `'${cut.replaceAll("'", "''")}'`;
}

type ValueList = { column: string; values: string[] };

async function valueLists(catalog: Table[]): Promise<Map<string, ValueList[]>> {
  const lists = new Map<string, ValueList[]>();
  for (const table of catalog) {
    const entries: ValueList[] = [];
    for (const column of table.columns) {
      if (!isTextType(column.type)) continue;
      const quotedColumn = `"${column.name.replaceAll('"', '""')}"`;
      const result = await executeReadOnly(
        `SELECT DISTINCT ${quotedColumn}::text FROM "${table.name.replaceAll('"', '""')}" WHERE ${quotedColumn} IS NOT NULL ORDER BY 1 LIMIT ${MAX_DISTINCT_VALUES + 1}`,
      );
      if (!result.ok) {
        throw new Error(`listing ${table.name}.${column.name} failed: ${result.errorMessage}`);
      }
      if (result.rows.length === 0 || result.rows.length > MAX_DISTINCT_VALUES) continue;
      entries.push({
        column: column.name,
        values: result.rows.map((row) => truncate(String(row[0]), MAX_CELL_LENGTH)),
      });
    }
    if (entries.length > 0) lists.set(table.name, entries);
  }
  return lists;
}

function isTextType(type: string): boolean {
  return type === 'text' || type.startsWith('character varying') || type.startsWith('character');
}

type Description = { column: string; text: string };

// BIRD ships database_description/<Table>.csv per source database. Table
// names lowercase to the Postgres spelling; column names match as loaded but
// are compared case-insensitively to be safe. A description that only repeats
// the column's name carries no signal and is dropped.
function loadDescriptions(catalog: Table[]): Map<string, Description[]> {
  const byTable = new Map<string, Description[]>();
  const tablesByLowerName = new Map(catalog.map((table) => [table.name.toLowerCase(), table]));

  for (const dbDir of readdirSync(DEV_DATABASES_DIR, { withFileTypes: true })) {
    if (!dbDir.isDirectory()) continue;
    const descriptionDir = new URL(`${dbDir.name}/database_description/`, DEV_DATABASES_DIR);
    let files: string[];
    try {
      files = readdirSync(descriptionDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.csv')) continue;
      const table = tablesByLowerName.get(file.slice(0, -'.csv'.length).toLowerCase());
      if (!table) continue;

      const columnsByLowerName = new Map(
        table.columns.map((column) => [column.name.toLowerCase(), column.name]),
      );
      const entries: Description[] = [];
      for (const record of csvRecords(new URL(file, descriptionDir))) {
        const columnName = columnsByLowerName.get((record.original_column_name ?? '').trim().toLowerCase());
        if (!columnName) continue;
        const text = describeColumn(columnName, record);
        if (text !== null) entries.push({ column: columnName, text });
      }
      if (entries.length > 0) byTable.set(table.name, entries);
    }
  }
  return byTable;
}

function describeColumn(
  columnName: string,
  record: Record<string, string | undefined>,
): string | null {
  const description = collapseWhitespace(record.column_description ?? '');
  const valueNote = collapseWhitespace(record.value_description ?? '');
  const combined = [description, valueNote].filter((part) => part !== '').join(' — ');
  if (combined === '') return null;
  if (normalizeForComparison(combined) === normalizeForComparison(columnName)) return null;
  return truncate(combined, MAX_DESCRIPTION_LENGTH);
}

function collapseWhitespace(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

function normalizeForComparison(text: string): string {
  return text.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function csvRecords(path: URL): Record<string, string | undefined>[] {
  const rows = parseCsv(readFileSync(path, 'utf8'));
  if (rows.length === 0) return [];
  const header = rows[0].map((name) => name.trim());
  return rows.slice(1).map((row) => {
    const record: Record<string, string | undefined> = {};
    header.forEach((name, index) => {
      record[name] = row[index];
    });
    return record;
  });
}

// The description CSVs use quoted fields with embedded commas, doubled-quote
// escapes, and newlines inside quotes, and open with a BOM — a split on
// newline silently corrupts them, hence a real parser.
export function parseCsv(text: string): string[][] {
  const input = text.startsWith('﻿') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => !(cells.length === 1 && cells[0] === ''));
}
