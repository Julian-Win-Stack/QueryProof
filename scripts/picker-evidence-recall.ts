// Stage 1 of the evidence-aware picker experiment (D20's reserved follow-up):
// recall only, no SQL generation. Runs picker-v3 (picker-v1 + the BIRD
// evidence hint) over every validated question and compares per-question table
// recall against the stored selections of a baseline run export.
//
//   npm run picker-recall                          all 500, concurrency 20
//   LIMIT=3 npm run picker-recall                  wiring smoke
//   BASELINE=runs/<file>.json npm run picker-recall
//
// Three numbers decide stage 2: how many of the 16 target questions flip to a
// recall hit, whether overall recall holds against the baseline, and whether
// the average tables sent stays near the baseline (a jump means this rebuilt
// EXPAND, whose recall gain bought no accuracy).

import { readFile, writeFile } from 'node:fs/promises';
import { llmPick, type PickerPrompt } from '../src/pickers/llm.ts';
import * as pickerV3 from '../src/prompts/picker-v3.ts';
import * as pickerV4 from '../src/prompts/picker-v4.ts';
import { EFFORT, MODEL, usdCost, type Usage } from '../src/model.ts';
import { loadSchema } from '../src/schema.ts';
import { recallHit } from '../src/table-recall.ts';

// The 16 questions the default configuration failed because the picker never
// sent a table the gold query needs — cluster 1 of the winnable-failure
// analysis (docs/winnable-failures.md, run 2026-07-31-152120-exp-rows-full).
const TARGET_IDS = [
  'bird-0014', 'bird-0023', 'bird-0039', 'bird-0041', 'bird-0045', 'bird-0057',
  'bird-0058', 'bird-0063', 'bird-0127', 'bird-0206', 'bird-0227', 'bird-0266',
  'bird-0314', 'bird-0356', 'bird-0366', 'bird-0367',
];

const BASELINE_PATH =
  process.env.BASELINE ?? 'runs/2026-08-01-122927-exp-v4-rewrites-full.json';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 20);
const LIMIT = process.env.LIMIT === undefined ? undefined : Number(process.env.LIMIT);

type GoldRecord = { id: string; question: string; evidence: string; sql: string };

type BaselineRow = {
  tablesSent: string[];
  tablesGoldNeeded: string[];
  recallHit: boolean;
};

type QuestionResult = {
  id: string;
  hit: boolean;
  tables: string[];
  error?: string;
};

const PROMPT: PickerPrompt = readPrompt();

function readPrompt(): PickerPrompt {
  const value = process.env.PICKER_PROMPT ?? 'picker-v3';
  const module_ = { 'picker-v3': pickerV3, 'picker-v4': pickerV4 }[value];
  if (module_ === undefined) throw new Error(`PICKER_PROMPT="${value}" — picker-v3 or picker-v4`);
  return {
    version: module_.PICKER_PROMPT_VERSION,
    system: module_.PICKER_SYSTEM,
    buildMessage: module_.buildPickerMessage,
  };
}

async function main(): Promise<void> {
  const gold = JSON.parse(await readFile('gold/validated.json', 'utf8')) as GoldRecord[];
  const records = LIMIT === undefined ? gold : gold.slice(0, LIMIT);
  const baseline = await readBaseline();
  const catalog = await loadSchema();

  const results: QuestionResult[] = [];
  const usageTotal: Usage & { calls: number } = {
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
    calls: 0,
  };

  let next = 0;
  async function worker(): Promise<void> {
    while (next < records.length) {
      const record = records[next++];
      const needed = baseline.get(record.id)?.tablesGoldNeeded;
      if (needed === undefined) throw new Error(`${record.id} is not in the baseline export`);
      try {
        const picked = await llmPick(record.question, catalog, PROMPT, undefined, record.evidence);
        const tables = picked.tables.map((table) => table.name);
        usageTotal.inputTokens += picked.usage.inputTokens;
        usageTotal.outputTokens += picked.usage.outputTokens;
        usageTotal.thinkingTokens += picked.usage.thinkingTokens;
        usageTotal.totalTokens += picked.usage.totalTokens;
        usageTotal.calls += 1;
        results.push({ id: record.id, hit: recallHit(needed, tables), tables });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ id: record.id, hit: false, tables: [], error: message });
      }
      if (results.length % 50 === 0) console.log(`  ${results.length}/${records.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, records.length) }, worker));

  report(results, baseline, records, usageTotal);
  await exportDetail(results, usageTotal);
}

async function readBaseline(): Promise<Map<string, BaselineRow>> {
  const run = JSON.parse(await readFile(BASELINE_PATH, 'utf8')) as {
    suites: {
      evals: { input: { id: string }; output: BaselineRow }[];
    }[];
  };
  const rows = new Map<string, BaselineRow>();
  for (const suite of run.suites) {
    for (const row of suite.evals) rows.set(row.input.id, row.output);
  }
  return rows;
}

function report(
  results: QuestionResult[],
  baseline: Map<string, BaselineRow>,
  records: GoldRecord[],
  usage: Usage & { calls: number },
): void {
  const scored = results.filter((result) => result.error === undefined);
  const errors = results.filter((result) => result.error !== undefined);

  const baselineRows = records.map((record) => baseline.get(record.id) as BaselineRow);
  const baselineHits = baselineRows.filter((row) => row.recallHit).length;
  const newHits = scored.filter((result) => result.hit).length;
  const baselineAvgTables =
    baselineRows.reduce((sum, row) => sum + row.tablesSent.length, 0) / baselineRows.length;
  const newAvgTables =
    scored.reduce((sum, result) => sum + result.tables.length, 0) / scored.length;

  const byId = new Map(results.map((result) => [result.id, result]));
  const targets = TARGET_IDS.filter((id) => byId.has(id));
  const targetFlips = targets.filter(
    (id) => baseline.get(id)?.recallHit === false && byId.get(id)?.hit === true,
  );
  const regressions = records.filter(
    (record) =>
      baseline.get(record.id)?.recallHit === true && byId.get(record.id)?.hit === false,
  );

  console.log('');
  console.log(`${PROMPT.version} (evidence) vs baseline ${BASELINE_PATH}`);
  console.log(`questions:        ${results.length} (${errors.length} errored)`);
  console.log(`recall:           ${pct(newHits, scored.length)} new vs ${pct(baselineHits, baselineRows.length)} baseline`);
  console.log(`avg tables sent:  ${newAvgTables.toFixed(2)} new vs ${baselineAvgTables.toFixed(2)} baseline`);
  console.log(`targets flipped:  ${targetFlips.length}/${targets.length} — ${targetFlips.join(', ') || 'none'}`);
  const targetMisses = targets.filter((id) => !(byId.get(id)?.hit ?? false));
  console.log(`targets still missed: ${targetMisses.join(', ') || 'none'}`);
  console.log(`regressions (hit -> miss): ${regressions.length}`);
  for (const record of regressions) {
    const row = baseline.get(record.id) as BaselineRow;
    const result = byId.get(record.id) as QuestionResult;
    console.log(`  ${record.id}: needed [${row.tablesGoldNeeded.join(', ')}], sent [${result.tables.join(', ')}]`);
  }
  console.log(`model: ${MODEL}, effort: ${EFFORT}`);
  console.log(`tokens: ${usage.inputTokens} in / ${usage.outputTokens} out (${usage.thinkingTokens} thinking) — $${usdCost(usage).toFixed(2)}`);
  for (const result of errors) console.log(`  ERROR ${result.id}: ${result.error}`);
}

function pct(numerator: number, denominator: number): string {
  return `${((numerator / denominator) * 100).toFixed(1)}% (${numerator}/${denominator})`;
}

async function exportDetail(
  results: QuestionResult[],
  usage: Usage & { calls: number },
): Promise<void> {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15);
  const path = `runs/${stamp}-${PROMPT.version}-recall-stage1.json`;
  const config = {
    pickerPrompt: PROMPT.version,
    model: MODEL,
    effort: EFFORT,
    baseline: BASELINE_PATH,
    limit: LIMIT ?? null,
    targetIds: TARGET_IDS,
  };
  await writeFile(path, JSON.stringify({ config, usage, results }, null, 1));
  console.log(`export: ${path}`);
}

await main();
