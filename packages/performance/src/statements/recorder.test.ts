import { expect, test } from "bun:test";
import {
  createStatementRecorder,
  defaultCaptureLimit,
  phaseFromConsole,
  phaseStartFromConsole,
  readCaptureEnvironment,
} from "./recorder";

function recorder(options: { paramHash?: boolean; limit?: number } = {}) {
  const lines: string[] = [];
  let label: string | undefined;
  const instance = createStatementRecorder({
    paramHash: options.paramHash ?? false,
    limit: options.limit ?? 100,
    write: (line) => lines.push(line),
    label: () => label,
  });
  return {
    instance,
    setLabel: (next: string | undefined) => {
      label = next;
    },
    records: () => lines.map((line): unknown => JSON.parse(line)),
  };
}

test("labels statements by test unless a probe names them", () => {
  const { instance, setLabel, records } = recorder();
  instance.startTest();
  instance.statement("select 1", [], undefined);
  setLabel("measured");
  instance.statement("select $1", [7], undefined);
  setLabel(undefined);
  instance.startTest();
  instance.phaseEnd("phase", 3);
  instance.statement("select 2", [], undefined);
  expect(records()).toEqual([
    { label: "test-1", sql: "select 1", params: 0 },
    { label: "measured", sql: "select $1", params: 1 },
    { phaseEnd: "phase", requests: 3 },
    { label: "test-2", sql: "select 2", params: 0 },
  ]);
});

test("hashes bind values without keeping them", () => {
  const { instance, records } = recorder({ paramHash: true });
  instance.statement("select $1", ["secret", 10n], undefined);
  instance.statement("select $1", ["secret", 10n], undefined);
  instance.statement("select $1", ["other", 10n], undefined);
  const hashes = records().map((record) =>
    Reflect.get(Object(record), "paramHash"),
  );
  expect(hashes[0]).toMatch(/^[0-9a-f]{12}$/u);
  expect(hashes[1]).toBe(hashes[0]);
  expect(hashes[2]).not.toBe(hashes[0]);
  expect(JSON.stringify(records())).not.toContain("secret");
});

test("hashes are keyed per capture", () => {
  const hash = () => {
    const { instance, records } = recorder({ paramHash: true });
    instance.statement("select $1", ["someone@example.com"], undefined);
    return Reflect.get(Object(records()[0]), "paramHash");
  };
  expect(hash()).not.toBe(hash());
});

test("numbers request scopes in the order they first send a statement", () => {
  const { instance, records } = recorder();
  const first = {};
  const second = {};
  instance.statement("select 1", [], second);
  instance.statement("select 2", [], first);
  instance.statement("select 3", [], undefined);
  instance.statement("select 4", [], second);
  expect(
    records().map((record) => Reflect.get(Object(record), "request")),
  ).toEqual([1, 2, undefined, 1]);
});

test("numbers transactions, records phase starts, and attaches route metadata", () => {
  const { instance, records } = recorder();
  const reqScope = {};
  const txA = {};
  const txB = {};
  instance.phaseStart("sync");
  instance.statement("select 1", [], reqScope, undefined);
  instance.statement("select 2", [], reqScope, txA);
  instance.statement("select 3", [], reqScope, txA);
  instance.statement("select 4", [], reqScope, txB);
  instance.requestScope(reqScope, {
    method: "POST",
    route: "/documents/{documentId}/sync",
    status: 200,
  });
  instance.phaseEnd("sync", 1);
  expect(records()).toEqual([
    { phaseStart: "sync" },
    { label: "test-0", sql: "select 1", params: 0, request: 1 },
    { label: "test-0", sql: "select 2", params: 0, request: 1, tx: 1 },
    { label: "test-0", sql: "select 3", params: 0, request: 1, tx: 1 },
    { label: "test-0", sql: "select 4", params: 0, request: 1, tx: 2 },
    {
      requestScope: 1,
      method: "POST",
      route: "/documents/{documentId}/sync",
      status: 200,
    },
    { phaseEnd: "sync", requests: 1 },
  ]);
  expect(
    phaseStartFromConsole(['[dual-pane-request-phase-start] {"label":"sync"}']),
  ).toBe("sync");
  expect(phaseStartFromConsole(["[other]"])).toBeNull();
});

test("stops at the limit with one truncation record", () => {
  const { instance, records } = recorder({ limit: 2 });
  for (let index = 0; index < 5; index += 1)
    instance.statement(`select ${index}`, [], undefined);
  expect(records()).toEqual([
    { label: "test-0", sql: "select 0", params: 0 },
    { label: "test-0", sql: "select 1", params: 0 },
    { truncated: 2 },
  ]);
});

test("reads phase ends from canary metrics lines only", () => {
  expect(
    phaseFromConsole([
      `[dual-pane-request-metrics] ${JSON.stringify({ label: "p", total: 4 })}`,
    ]),
  ).toEqual({ label: "p", requests: 4 });
  expect(
    phaseFromConsole(["[dual-pane-request-profile] p total=4"]),
  ).toBeNull();
  expect(phaseFromConsole([{ label: "p" }])).toBeNull();
  expect(
    phaseFromConsole(['[dual-pane-request-metrics] {"label":"p"}']),
  ).toBeNull();
  expect(
    phaseFromConsole(['[dual-pane-request-metrics] {"label":']),
  ).toBeNull();
});

test("requires an output file and a positive limit", () => {
  expect(readCaptureEnvironment({ PERF_STATEMENTS_OUT: "/x" })).toEqual({
    out: "/x",
    paramHash: false,
    limit: defaultCaptureLimit,
  });
  expect(
    readCaptureEnvironment({
      PERF_STATEMENTS_OUT: "/x",
      PERF_STATEMENTS_PARAM_HASH: "1",
      PERF_STATEMENTS_LIMIT: "5",
    }),
  ).toEqual({ out: "/x", paramHash: true, limit: 5 });
  expect(() => readCaptureEnvironment({})).toThrow(/PERF_STATEMENTS_OUT/);
  expect(() =>
    readCaptureEnvironment({
      PERF_STATEMENTS_OUT: "/x",
      PERF_STATEMENTS_LIMIT: "0",
    }),
  ).toThrow(/LIMIT/);
});
