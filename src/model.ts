// The only place the model id and the reasoning effort live. Every number in
// the README comes from them, so changing either retires the earlier numbers
// rather than carrying them forward — the old ones stay in evalite's store
// looking comparable when they are not.
//
// Eval runs go straight to api.openai.com. The Respan gateway caches, and a
// cached repeat run reports zero variance, which reads as a stable measurement
// rather than as no measurement at all. The gateway arrives at Phase 8, on the
// product path only.

import OpenAI from 'openai';

// Never the bare gpt-5.6 alias: it routes to gpt-5.6-sol, a different and
// pricier model.
export const MODEL = process.env.MODEL ?? 'gpt-5.6-terra';

const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

// Pinned (D18). Read from env so every run records a value rather than
// inheriting whatever the API defaults to on the day it ran — there is no
// `auto`, and an omitted parameter is a choice that can move server-side.
export const EFFORT: Effort = readEffort();

function readEffort(): Effort {
  const value = process.env.EFFORT ?? 'medium';
  const effort = EFFORTS.find((candidate) => candidate === value);
  if (!effort) throw new Error(`EFFORT="${value}" is not one of ${EFFORTS.join(', ')}`);
  return effort;
}

export type Usage = {
  promptTokens: number;
  completionTokens: number;
  // Billed as output tokens, so output cost runs well above what the visible
  // reply length suggests. Reported separately to make that visible.
  reasoningTokens: number;
  totalTokens: number;
};

export type ModelReply = {
  json: unknown;
  usage: Usage;
  rateLimit: Record<string, string>;
  ms: number;
};

// Kept next to MODEL: a different id prices differently, and holding the two
// apart is how a stale price survives a model change unnoticed.
const USD_PER_MILLION_INPUT = 2.5;
const USD_PER_MILLION_OUTPUT = 15;

// completionTokens already includes reasoningTokens, so reasoning is not added
// again here — it is reported separately only to show where the cost went.
export function usdCost(usage: Usage): number {
  const input = usage.promptTokens * USD_PER_MILLION_INPUT;
  const output = usage.completionTokens * USD_PER_MILLION_OUTPUT;
  return (input + output) / 1_000_000;
}

let client: OpenAI | undefined;

function openai(): OpenAI {
  if (client) return client;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set — see CLAUDE.md.');

  client = new OpenAI({ apiKey });
  return client;
}

// The six x-ratelimit-* headers are the only authoritative ceiling for this key,
// and every concurrency decision downstream reads them (D12).
function rateLimitHeaders(headers: Headers): Record<string, string> {
  const found: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (name.startsWith('x-ratelimit-')) found[name] = value;
  });
  return found;
}

// Returns the parsed reply as unknown rather than as a generic: strict
// json_schema constrains what the model may emit, but a generic here would only
// look like the caller had checked. Callers narrow.
export async function completeJson(params: {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
}): Promise<ModelReply> {
  const startedAt = Date.now();

  // No temperature / top_p / n / penalties: reasoning models fix them and
  // reject any other value.
  const { data, response } = await openai()
    .chat.completions.create({
      model: MODEL,
      reasoning_effort: EFFORT,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
      // The contract, not a request. Scraping a fenced code block out of prose
      // fails silently — a missed match scores as a wrong answer, so the
      // accuracy number ends up partly measuring the regex.
      response_format: {
        type: 'json_schema',
        json_schema: { name: params.schemaName, schema: params.schema, strict: true },
      },
    })
    .withResponse();

  const choice = data.choices[0];
  const content = choice?.message.content;
  if (!content) {
    throw new Error(`${MODEL} returned no content (finish_reason: ${choice?.finish_reason ?? 'none'})`);
  }

  const usage = data.usage;

  return {
    json: JSON.parse(content),
    usage: {
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
    },
    rateLimit: rateLimitHeaders(response.headers),
    ms: Date.now() - startedAt,
  };
}
