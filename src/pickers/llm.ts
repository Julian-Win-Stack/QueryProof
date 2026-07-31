// Phase 6c — the LLM picker. One call to the pinned model: 75 lines of
// "table: columns" in, a shortlist out. Structured output, same contract as
// SQL generation — never scraped from prose.

import { completeJson, type Usage } from '../model.ts';
import { buildPickerMessage, PICKER_PROMPT_VERSION, PICKER_SYSTEM } from '../prompts/picker-v1.ts';
import type { Table } from '../schema.ts';
import { PICKER_TABLE_CAP } from './keyword.ts';

// No maxItems: the API rejects it on array schemas ("property 'maxItems' is
// not supported"), so the cap lives in the prompt and in resolveNames.
const SHORTLIST_SCHEMA = {
  type: 'object',
  properties: {
    tables: { type: 'array', items: { type: 'string' } },
  },
  required: ['tables'],
  additionalProperties: false,
};

export type LlmPick = {
  tables: Table[];
  promptVersion: string;
  usage: Usage;
  ms: number;
};

export async function llmPick(question: string, tables: Table[]): Promise<LlmPick> {
  const catalogText = tables
    .map((table) => `${table.name}: ${table.columns.map((column) => column.name).join(', ')}`)
    .join('\n');

  const reply = await completeJson({
    system: PICKER_SYSTEM,
    user: buildPickerMessage({ question, catalogText }),
    schema: SHORTLIST_SCHEMA,
  });

  return {
    tables: resolveNames(readNames(reply.json), tables),
    promptVersion: PICKER_PROMPT_VERSION,
    usage: reply.usage,
    ms: reply.ms,
  };
}

// An invented name is dropped rather than thrown: a picker mistake has to
// surface as a recall miss and a scored wrong answer, not as a voided
// question — voiding would hide exactly the failures the bake-off measures.
function resolveNames(names: string[], tables: Table[]): Table[] {
  const byLowercaseName = new Map(tables.map((table) => [table.name.toLowerCase(), table]));
  const picked: Table[] = [];
  for (const name of names) {
    const table = byLowercaseName.get(name.toLowerCase());
    if (table && !picked.includes(table)) picked.push(table);
  }
  return picked.slice(0, PICKER_TABLE_CAP);
}

function readNames(json: unknown): string[] {
  if (typeof json !== 'object' || json === null || !('tables' in json)) {
    throw new Error(`expected { tables: string[] }, got ${JSON.stringify(json)}`);
  }
  const { tables } = json;
  if (!Array.isArray(tables) || tables.some((name) => typeof name !== 'string')) {
    throw new Error(`tables came back as ${JSON.stringify(tables)}, not a string array`);
  }
  return tables as string[];
}
