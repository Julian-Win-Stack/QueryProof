// The only place the model id and the effort level live. Every number in the
// README comes from them, so changing either retires the earlier numbers
// rather than carrying them forward — the old ones stay in evalite's store
// looking comparable when they are not.
//
// Eval runs go straight to api.anthropic.com. The Respan gateway caches, and a
// cached repeat run reports zero variance, which reads as a stable measurement
// rather than as no measurement at all. The gateway arrives at Phase 8, on the
// product path only.

import Anthropic from '@anthropic-ai/sdk';

export const MODEL = process.env.MODEL ?? 'claude-sonnet-5';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

// Pinned (D18). Read from env so every run records a value rather than
// inheriting the API's default — that default is `high`, and an omitted
// parameter is a choice that can move server-side.
export const EFFORT: Effort = readEffort();

function readEffort(): Effort {
  const value = process.env.EFFORT ?? 'medium';
  const effort = EFFORTS.find((candidate) => candidate === value);
  if (!effort) throw new Error(`EFFORT="${value}" is not one of ${EFFORTS.join(', ')}`);
  return effort;
}

// Required by the Messages API, and it caps thinking and the reply *together*.
// Generous for one line of SQL because thinking is on by default and spends
// most of it. Raise it to 64k before running EFFORT=xhigh or max.
const MAX_TOKENS = 16_000;

export type Usage = {
  // With caching in play this is the *uncached remainder only* — the API moves
  // cached tokens out of input_tokens into the two cache fields below. The
  // three add up to what was actually sent.
  inputTokens: number;
  outputTokens: number;
  // Already counted inside outputTokens and billed at the output rate, so
  // output cost runs well above what the visible reply length suggests.
  // Reported separately to make that visible.
  thinkingTokens: number;
  // Tokens written to / read from the prompt cache. Zero on every uncached
  // call, so pre-caching totals are unchanged by these fields existing.
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
};

export type ModelReply = {
  json: unknown;
  usage: Usage;
  rateLimit: Record<string, string>;
  ms: number;
};

// Kept next to MODEL: a different id prices differently, and holding the two
// apart is how a stale price survives a model change unnoticed. These are
// Sonnet 5's *introductory* rates, which expire 2026-08-31 and revert to
// 3 / 15 — a run after that date costs 1.5x what this function reports.
const USD_PER_MILLION_INPUT = 2;
const USD_PER_MILLION_OUTPUT = 10;
// Anthropic's fixed multiples of the input rate: cache writes bill 1.25x
// (5-minute TTL), cache reads 0.1x.
const USD_PER_MILLION_CACHE_WRITE = USD_PER_MILLION_INPUT * 1.25;
const USD_PER_MILLION_CACHE_READ = USD_PER_MILLION_INPUT * 0.1;

// outputTokens already includes thinkingTokens, so thinking is not added again
// here — it is reported separately only to show where the cost went.
export function usdCost(usage: Usage): number {
  const input = usage.inputTokens * USD_PER_MILLION_INPUT;
  const output = usage.outputTokens * USD_PER_MILLION_OUTPUT;
  const cacheWrite = usage.cacheCreationTokens * USD_PER_MILLION_CACHE_WRITE;
  const cacheRead = usage.cacheReadTokens * USD_PER_MILLION_CACHE_READ;
  return (input + output + cacheWrite + cacheRead) / 1_000_000;
}

function readUsage(usage: Anthropic.Usage): Usage {
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    thinkingTokens: usage.output_tokens_details?.thinking_tokens ?? 0,
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead,
    totalTokens: usage.input_tokens + usage.output_tokens + cacheCreation + cacheRead,
  };
}

let client: Anthropic | undefined;

// PRODUCT_PATH=1 routes every model call through the Respan gateway — caching,
// fallback and tracing, wins for the demo and poison for measurement. Only the
// demo's start script sets it, and the eval file refuses to run under it.
const RESPAN_BASE_URL = 'https://api.respan.ai/api/anthropic/';

function anthropic(): Anthropic {
  if (client) return client;

  if (process.env.PRODUCT_PATH === '1') {
    const respanKey = process.env.RESPAN_API_KEY;
    if (!respanKey) throw new Error('PRODUCT_PATH=1 needs RESPAN_API_KEY — see CLAUDE.md.');
    // The Respan key goes where the Anthropic key would; the gateway holds the
    // provider credentials.
    client = new Anthropic({ apiKey: respanKey, baseURL: RESPAN_BASE_URL, maxRetries: 5 });
    return client;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set — see CLAUDE.md.');

  // 5 rather than the SDK's default 2 (D12). A 429 that survives every retry
  // voids the whole run (D12b), so retrying harder is cheap next to re-running.
  client = new Anthropic({ apiKey, maxRetries: 5 });
  return client;
}

// The anthropic-ratelimit-* headers, plus retry-after on a 429, are the only
// authoritative ceiling for this key, and every concurrency decision downstream
// reads them (D12). Input and output tokens are throttled separately here, so
// there are two token ceilings to read, not one.
function rateLimitHeaders(headers: Headers): Record<string, string> {
  const found: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (name.startsWith('anthropic-ratelimit-') || name === 'retry-after') found[name] = value;
  });
  return found;
}

export type ToolReply = {
  content: Anthropic.ContentBlock[];
  stopReason: Anthropic.Message['stop_reason'];
  usage: Usage;
  ms: number;
};

// The second way to call the model, for the agent loop: offer tools, get back
// content blocks the caller branches on. completeJson stays untouched — the
// pipeline still uses it, and its numbers must not move.
//
// cache_control at the top level turns on automatic prompt caching: the agent
// resends the whole conversation every pass, and without caching each pass
// re-bills the schema and every earlier turn at the full input rate. The
// pipeline's single-turn calls stay uncached on purpose — their cost numbers
// predate caching and stay comparable.
export async function completeWithTools(params: {
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  toolChoice?: Anthropic.ToolChoice;
}): Promise<ToolReply> {
  const startedAt = Date.now();

  const data = await anthropic().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: params.system,
    messages: params.messages,
    tools: params.tools,
    ...(params.toolChoice === undefined ? {} : { tool_choice: params.toolChoice }),
    output_config: { effort: EFFORT },
    cache_control: { type: 'ephemeral' },
  });

  if (data.stop_reason === 'refusal') {
    const { category, explanation } = data.stop_details ?? {};
    throw new Error(`${MODEL} refused: ${category ?? 'no category'} — ${explanation ?? 'no explanation'}`);
  }

  if (data.stop_reason === 'max_tokens') {
    throw new Error(`${MODEL} hit max_tokens (${MAX_TOKENS}) mid-answer — thinking and the reply share that budget`);
  }

  return {
    content: data.content,
    stopReason: data.stop_reason,
    usage: readUsage(data.usage),
    ms: Date.now() - startedAt,
  };
}

// Returns the parsed reply as unknown rather than as a generic: a strict output
// schema constrains what the model may emit, but a generic here would only look
// like the caller had checked. Callers narrow.
export async function completeJson(params: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
}): Promise<ModelReply> {
  const startedAt = Date.now();

  // No temperature / top_p / top_k: this model rejects them. Thinking is on by
  // default and its depth is what EFFORT controls.
  const { data, response } = await anthropic()
    .messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: params.system,
      messages: [{ role: 'user', content: params.user }],
      output_config: {
        effort: EFFORT,
        // The contract, not a request. Scraping a fenced code block out of
        // prose fails silently — a missed match scores as a wrong answer, so
        // the accuracy number ends up partly measuring the regex.
        format: { type: 'json_schema', schema: params.schema },
      },
    })
    .withResponse();

  if (data.stop_reason === 'refusal') {
    const { category, explanation } = data.stop_details ?? {};
    throw new Error(`${MODEL} refused: ${category ?? 'no category'} — ${explanation ?? 'no explanation'}`);
  }

  if (data.stop_reason === 'max_tokens') {
    throw new Error(`${MODEL} hit max_tokens (${MAX_TOKENS}) mid-answer — thinking and the reply share that budget`);
  }

  // Thinking blocks arrive ahead of the answer, so the reply is the first text
  // block rather than the first block.
  const answer = data.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
  if (!answer) {
    throw new Error(`${MODEL} returned no text block (stop_reason: ${data.stop_reason ?? 'none'})`);
  }

  const { usage } = data;

  return {
    json: JSON.parse(answer.text),
    usage: readUsage(usage),
    rateLimit: rateLimitHeaders(response.headers),
    ms: Date.now() - startedAt,
  };
}
