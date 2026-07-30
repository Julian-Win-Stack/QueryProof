import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderSchema, type Table } from './schema.ts';

test('a table renders as quoted DDL, with NOT NULL only where the column forbids null', () => {
  const customers: Table = {
    name: 'customers',
    columns: [
      { name: 'customerid', type: 'bigint', nullable: false },
      { name: 'currency', type: 'text', nullable: true },
    ],
    primaryKey: ['customerid'],
    foreignKeys: [],
  };

  assert.equal(
    renderSchema([customers]),
    [
      'CREATE TABLE "customers" (',
      '  "customerid" bigint NOT NULL,',
      '  "currency" text,',
      '  PRIMARY KEY ("customerid")',
      ');',
    ].join('\n'),
  );
});

test('a composite primary key keeps the column order Postgres stores', () => {
  const laptimes: Table = {
    name: 'laptimes',
    columns: [
      { name: 'raceid', type: 'bigint', nullable: false },
      { name: 'driverid', type: 'bigint', nullable: false },
      { name: 'lap', type: 'bigint', nullable: false },
    ],
    primaryKey: ['raceid', 'driverid', 'lap'],
    foreignKeys: [],
  };

  assert.match(renderSchema([laptimes]), /PRIMARY KEY \("raceid", "driverid", "lap"\)/);
});

test('a foreign key renders as the join it licenses', () => {
  const account: Table = {
    name: 'account',
    columns: [{ name: 'district_id', type: 'bigint', nullable: true }],
    primaryKey: [],
    foreignKeys: [{ column: 'district_id', refTable: 'district', refColumn: 'district_id' }],
  };

  assert.match(
    renderSchema([account]),
    /FOREIGN KEY \("district_id"\) REFERENCES "district" \("district_id"\)/,
  );
});

test('a table without a primary key renders no PRIMARY KEY line', () => {
  // Seven of the 75 tables have none, and PRIMARY KEY () is a syntax error the
  // model would copy out of the schema text.
  const foreignData: Table = {
    name: 'foreign_data',
    columns: [{ name: 'uuid', type: 'text', nullable: true }],
    primaryKey: [],
    foreignKeys: [],
  };

  assert.ok(!renderSchema([foreignData]).includes('PRIMARY KEY'));
});
