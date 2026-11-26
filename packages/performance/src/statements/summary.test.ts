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
