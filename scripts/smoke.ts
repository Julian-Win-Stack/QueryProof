// Phase 4a's exit test. One call, no SQL and no schema text involved, to prove
// the round trip works before anything is built on top of it.
//
// The x-ratelimit-* numbers it prints go into RUNS.md by hand: they are the only
// authoritative ceiling for this key, and every concurrency decision downstream
// reads them (D12).

import { completeJson, EFFORT, MODEL } from '../src/model.ts';

async function main(): Promise<void> {
  const reply = await completeJson({
    system: 'Answer with JSON matching the given schema.',
    user: 'What is the capital of France, and in what year did the Eiffel Tower open?',
    schemaName: 'smoke',
    schema: {
      type: 'object',
      properties: {
        capital: { type: 'string' },
        year: { type: 'integer' },
      },
      required: ['capital', 'year'],
      additionalProperties: false,
    },
  });

  console.log(`model:   ${MODEL}`);
  console.log(`effort:  ${EFFORT}`);
  console.log(`ms:      ${reply.ms}`);
  console.log('');
  console.log('parsed reply:');
  console.log(reply.json);
  console.log('');
  console.log('usage:');
  console.log(`  prompt tokens:     ${reply.usage.promptTokens}`);
  console.log(`  completion tokens: ${reply.usage.completionTokens}`);
  console.log(`  reasoning tokens:  ${reply.usage.reasoningTokens}  (billed as output)`);
  console.log(`  total tokens:      ${reply.usage.totalTokens}`);
  console.log('');
  console.log('rate limit headers — copy these into RUNS.md:');
  const headers = Object.entries(reply.rateLimit).sort();
  if (headers.length === 0) console.log('  none returned');
  for (const [name, value] of headers) console.log(`  ${name}: ${value}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
