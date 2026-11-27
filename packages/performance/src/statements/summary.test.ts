import { expect, test } from "bun:test";
import type { CaptureRecord } from "./recorder";
import { normalizeSql, parseCapture, summarizeCapture } from "./summary";

const statement = (
  label: string,
  sql: string,
  paramHash?: string,
): CaptureRecord => ({
  label,
  sql,
  params: 1,
  ...(paramHash === undefined ? {} : { paramHash }),
});

test("normalizes whitespace and placeholder lists", () => {
  expect(normalizeSql("select *\n  from t where id in ($1, $2,$3)")).toBe(
    "select * from t where id in ($n, …)",
  );
  expect(normalizeSql("select $1")).toBe("select $1");
});

test("groups by label and splits phases at their markers", () => {
  const summary = summarizeCapture([
    statement("test-1", "select a"),
    statement("test-1", "select a"),
    { phaseEnd: "first", requests: 2 },
    statement("test-1", "select b"),
    statement("probe", "select  a"),
    { phaseEnd: "second", requests: 0 },
    { phaseEnd: "total", requests: 2 },
  ]);
  expect(summary.statements).toBe(4);
  expect(summary.truncated).toBe(false);
  expect(summary.paramHashes).toBe(false);
  expect(summary.top).toEqual([
    { sql: "select a", count: 3 },
    { sql: "select b", count: 1 },
  ]);
  expect(
    summary.labels.map(({ label, statements }) => [label, statements]),
  ).toEqual([
    ["test-1", 3],
    ["probe", 1],
  ]);
  expect(summary.labels[0]?.sameKeyRepeats).toBeNull();
  expect(
    summary.phases.map(({ label, requests, statements }) => [
      label,
      requests,
      statements,
    ]),
  ).toEqual([
    ["first", 2, 2],
    ["second", 0, 2],
    ["total", 2, 0],
  ]);
});

test("counts same-key repeats within one request scope", () => {
  const inRequest = (request: number, paramHash: string): CaptureRecord => ({
    label: "t",
    sql: "select a",
    params: 1,
    paramHash,
    request,
  });
  const summary = summarizeCapture([
    inRequest(1, "k1"),
    inRequest(1, "k1"),
    inRequest(2, "k1"),
    inRequest(2, "k2"),
  ]);
  expect(summary.labels[0]?.requestScopes).toBe(2);
  expect(summary.labels[0]?.sameKeyRepeats).toEqual([
    { sql: "select a", count: 1 },
  ]);
});

test("counts extra sends of one statement with the same bind values", () => {
  const summary = summarizeCapture([
    statement("t", "select a", "k1"),
    statement("t", "select a", "k1"),
    statement("t", "select a", "k1"),
    statement("t", "select a", "k2"),
    statement("t", "select b", "k3"),
    { truncated: 5 },
  ]);
  expect(summary.truncated).toBe(true);
  expect(summary.paramHashes).toBe(true);
  expect(summary.labels[0]?.sameKeyRepeats).toEqual([
    { sql: "select a", count: 2 },
  ]);
});

test("scopes phases by phaseStart, aggregates routes, and separates pure read repeats from post-write reads", () => {
  const summary = summarizeCapture([
    // Setup before phaseStart is excluded from the phase window.
    { label: "t", sql: 'select id from "setup"', params: 0, request: 1 },
    { phaseStart: "write" },
    {
      label: "t",
      sql: 'select id from "users" where id = $1',
      params: 1,
      paramHash: "u1",
      request: 2,
      tx: 1,
    },
    // Pure read repeat: no write to "users" in between.
    {
      label: "t",
      sql: 'select id from "users" where id = $1',
      params: 1,
      paramHash: "u1",
      request: 2,
      tx: 1,
    },
    {
      label: "t",
      sql: 'select id from "docs" where id = $1 for update',
      params: 1,
      paramHash: "d1",
      request: 2,
      tx: 1,
    },
    // Runs under lock and mutates "docs".
    {
      label: "t",
      sql: 'update "docs" set version = $1 where id = $2',
      params: 2,
      paramHash: "d1u",
      request: 2,
      tx: 1,
    },
    // Same-key repeat on "docs", but after an UPDATE to "docs": NOT a pure read repeat.
    {
      label: "t",
      sql: 'select id from "docs" where id = $1 for update',
      params: 1,
      paramHash: "d1",
      request: 2,
      tx: 1,
    },
    {
      requestScope: 2,
      method: "POST",
      route: "/documents/{documentId}/sync",
      status: 200,
    },
    { phaseEnd: "write", requests: 1 },
  ]);

  expect(summary.txStatements).toBe(5);
  expect(summary.transactions).toBe(1);
  expect(summary.lockHoldStatements).toBe(2);
  expect(summary.phases).toHaveLength(1);
  expect(summary.phases[0]).toMatchObject({
    label: "write",
    requests: 1,
    statements: 5,
    txStatements: 5,
    lockHoldStatements: 2,
    exactWindow: true,
    sameKeyRepeats: [
      { sql: 'select id from "docs" where id = $1 for update', count: 1 },
      { sql: 'select id from "users" where id = $1', count: 1 },
    ],
    pureReadRepeats: [
      { sql: 'select id from "users" where id = $1', count: 1 },
    ],
  });
  expect(summary.routes).toEqual([
    {
      route: "POST /documents/{documentId}/sync",
      requests: 1,
      statements: 5,
      txStatements: 5,
      lockHoldStatements: 2,
      maxPerRequest: 5,
      sameKeyRepeats: 2,
      pureReadRepeats: 1,
      topRepeat: { sql: 'select id from "users" where id = $1', count: 1 },
    },
  ]);
});

test("parses capture lines and rejects foreign ones", () => {
  expect(
    parseCapture(
      '{"label":"t","sql":"select 1","params":0}\n\n{"phaseEnd":"p","requests":1}\n',
    ),
  ).toEqual([
    { label: "t", sql: "select 1", params: 0 },
    { phaseEnd: "p", requests: 1 },
  ]);
  expect(() => parseCapture('{"sql":"select 1"}')).toThrow(/line 1/);
});

test("summarizes a large capture under one label in linear time", () => {
  // Grouping by copying each label's list took about 30 s for these
  // 200,000 records, and never finished at the 1,000,000-record default
  // limit; one pass takes well under a second.
  const records = Array.from(
    { length: 200_000 },
    (_, index): CaptureRecord => ({
      label: "one long test",
      sql: "select * from t where id = $1",
      params: 1,
      paramHash: `k${index % 1_000}`,
      request: index % 500,
    }),
  );
  const started = performance.now();
  const summary = summarizeCapture(records);
  expect(performance.now() - started).toBeLessThan(5_000);
  expect(summary.labels).toHaveLength(1);
  expect(summary.labels[0]).toMatchObject({
    statements: 200_000,
    requestScopes: 500,
  });
}, 30_000);
