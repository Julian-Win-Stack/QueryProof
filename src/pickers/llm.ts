// Phase 6c — the LLM picker. One call to the pinned model: 75 lines of
// "table: columns" in, a shortlist out. Structured output, same contract as
// SQL generation — never scraped from prose.

import { completeJson, type Usage } from '../model.ts';
import * as pickerV1 from '../prompts/picker-v1.ts';
import type { Table } from '../schema.ts';
import { PICKER_TABLE_CAP } from './keyword.ts';

// The prompt is a parameter so the picker-v1 vs picker-v2 experiment is a
// different argument, not a different picker. Callers that say nothing get v1
// — the version behind the published numbers.
export type PickerPrompt = {
  version: string;
  system: string;
  buildMessage: (params: { question: string; catalogText: string }) => string;
};

export const PICKER_V1: PickerPrompt = {
  version: pickerV1.PICKER_PROMPT_VERSION,
  system: pickerV1.PICKER_SYSTEM,
  buildMessage: pickerV1.buildPickerMessage,
};

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

export async function llmPick(
  question: string,
  tables: Table[],
  prompt: PickerPrompt = PICKER_V1,
  // Extra lines per table name (value lists, descriptions) — the
  // PICKER_CONTEXT experiments. Absent for every published number.
  extraLines?: Map<string, string>,
): Promise<LlmPick> {
  const catalogText = tables
    .map((table) => {
      const line = `${table.name}: ${table.columns.map((column) => column.name).join(', ')}`;
      const extra = extraLines?.get(table.name);
      return extra === undefined ? line : `${line}\n${extra}`;
    })
    .join('\n');

  const reply = await completeJson({
    system: prompt.system,
    user: prompt.buildMessage({ question, catalogText }),
    schema: SHORTLIST_SCHEMA,
  });

  return {
    tables: resolveNames(readNames(reply.json), tables),
    promptVersion: prompt.version,
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
