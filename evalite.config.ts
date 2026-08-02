// evalite v1 defaults to in-memory storage — an unconfigured run keeps nothing
// at all (D10). The SQLite file drives the UI and run-over-run diffing; the
// committed JSON export per run (--outputPath) is the evidence.

import { defineConfig } from 'evalite/config';
import { createSqliteStorage } from 'evalite/sqlite-storage';

// D12, set 2026-07-30: 50 for EASY / dev-slice / picker / repair runs, 15 for
// the 75-table baseline. Opening figures — tune down from observed 429s.
const DEFAULT_CONCURRENCY = 50;

// A real question at EFFORT=medium thinks for a while, and the SDK retries
// 429s five times with backoff on top of that. Vitest's 30s default would kill
// the slowest questions and report them as failures. Agent runs set
// EVAL_TIMEOUT_MS higher — up to 10 model calls per question.
const TEST_TIMEOUT_MS = 300_000;

export default defineConfig({
  storage: () => createSqliteStorage('./.evalite/evalite.db'),
  maxConcurrency: Number(process.env.CONCURRENCY ?? DEFAULT_CONCURRENCY),
  trialCount: Number(process.env.TRIALS ?? 1),
  testTimeout: Number(process.env.EVAL_TIMEOUT_MS ?? TEST_TIMEOUT_MS),
  // A cached response voids a run (RUNS.md). This cache only wraps AI SDK
  // models, which the project does not use — off anyway, so that stays
  // structural rather than incidental.
  cache: false,
});
