// Needs the Postgres container. Named .dbtest.ts so `npm test` — which stays
// pure (D4) — does not discover it. Run it with `npm run test:db`.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { closeReadOnlyPool, executeReadOnly } from './execute-readonly.ts';

after(closeReadOnlyPool);

test('an insert is refused on a table the role can read', async () => {
  const identity = await executeReadOnly('SELECT current_user');
  assert.ok(identity.ok, 'could not connect');
  assert.deepEqual(identity.rows, [['queryproof_ro']]);

  // Without this the refusal below could come from a missing table, which
  // would be the test passing for the wrong reason.
  const read = await executeReadOnly('SELECT customerid FROM customers LIMIT 1');
  assert.ok(read.ok, 'the role cannot read customers');
  assert.equal(read.rows.length, 1);

  const write = await executeReadOnly(
    "INSERT INTO customers (customerid, segment, currency) VALUES (-1, 'seg', 'EUR')",
  );
  assert.ok(!write.ok, 'the insert was not refused');
  assert.equal(write.errorCode, '42501');
});

test('rows come back positionally, with column names alongside', async () => {
  const result = await executeReadOnly("SELECT 1 AS a, 'x' AS b");

  assert.ok(result.ok);
  assert.deepEqual(result.rows, [[1, 'x']]);
  assert.deepEqual(result.columns, ['a', 'b']);
});

test('a Postgres error is a result, not a thrown exception', async () => {
  const result = await executeReadOnly('SELECT * FROM no_such_table');

  assert.ok(!result.ok);
  assert.equal(result.errorCode, '42P01');
});

test('timestamps render in the Asia/Shanghai session zone', async () => {
  const result = await executeReadOnly("SELECT '2020-01-01 12:00:00+00'::timestamptz::text");

  assert.ok(result.ok);
  assert.deepEqual(result.rows, [['2020-01-01 20:00:00+08']]);
});

test('a query past the statement timeout is aborted', async () => {
  const result = await executeReadOnly('SELECT pg_sleep(20)');

  assert.ok(!result.ok);
  assert.equal(result.errorCode, '57014');
  // 57014 alone would also pass under a 1s or a 60s timeout. Gold validation
  // used 15s, so eval execution has to abort at the same point.
  assert.ok(
    result.ms >= 14_000 && result.ms < 18_000,
    `aborted after ${result.ms}ms, so the timeout is not the 15s gold validation used`,
  );
});
