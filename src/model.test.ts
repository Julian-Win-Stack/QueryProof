// usdCost arithmetic. The cache fields were added 2026-08-01 for the agent —
// the one thing worth pinning is that a usage with zero cache traffic prices
// exactly as it did before the fields existed.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { usdCost, type Usage } from './model.ts';

function usage(partial: Partial<Usage>): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    ...partial,
  };
}

test('no cache traffic prices at the two original rates', () => {
  // 1M in at $2 + 1M out at $10
  assert.equal(usdCost(usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 })), 12);
});

test('cache writes bill at 1.25x the input rate', () => {
  assert.equal(usdCost(usage({ cacheCreationTokens: 1_000_000 })), 2.5);
});

test('cache reads bill at 0.1x the input rate', () => {
  assert.equal(usdCost(usage({ cacheReadTokens: 1_000_000 })), 0.2);
});

test('a cached call sums all four meters', () => {
  const cost = usdCost(
    usage({
      inputTokens: 500_000, // $1.00
      outputTokens: 100_000, // $1.00
      cacheCreationTokens: 200_000, // $0.50
      cacheReadTokens: 1_000_000, // $0.20
    }),
  );
  assert.equal(cost, 2.7);
});
