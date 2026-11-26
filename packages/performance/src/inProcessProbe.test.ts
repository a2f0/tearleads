import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { probeReport, runInProcessProbe } from "./inProcessProbe";
import type { InProcessApi } from "./realtime/inProcessApi";
import { emptyTraffic } from "./realtime/postgresWire";

const header = {
  schemaVersion: 1,
  scenario: "document-reload",
  runId: "run",
  startedAt: "2026-11-25T00:00:00.000Z",
  database: "scratch",
  options: {},
  boundary: "local",
  revision: "abc",
  dirty: false,
  runtime: {},
  updatedAt: "2026-11-25T00:00:01.000Z",
  status: "complete",
};

test("a report puts the probe's results after its header", () => {
  const report = probeReport(header, { summary: [], measurements: [1] });
  expect(Object.keys(report).slice(-3)).toEqual([
    "status",
    "summary",
    "measurements",
  ]);
  expect(report).toMatchObject({ measurements: [1] });
});

test("untyped results cannot replace a header field", () => {
  const untyped = JSON.parse(
    '{"status": "complete", "runId": "other", "summary": []}',
  );
  expect(() => probeReport(header, untyped)).toThrow(
    "Probe results cannot set runId, status.",
  );
});

const environment = { ...process.env };
const quiet = [
  spyOn(console, "log").mockImplementation(() => undefined),
  spyOn(console, "error").mockImplementation(() => undefined),
];

afterAll(() => {
  for (const spy of quiet) spy.mockRestore();
});

beforeEach(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgres://probe@localhost:5432/probe_test",
  });
});

afterEach(() => {
  for (const key of Object.keys(process.env))
    if (!(key in environment)) Reflect.deleteProperty(process.env, key);
  Object.assign(process.env, environment);
  for (const spy of quiet) spy.mockClear();
});

/** Services that record what the run saved and stopped. */
function fakeServices(
  failures: {
    readonly startApi?: Error;
    readonly stopApi?: Error;
    readonly finalSave?: Error;
  } = {},
) {
  const statuses: unknown[] = [];
  const stopped: string[] = [];
  const api = {
    origin: "http://127.0.0.1:1",
    stop: async () => {
      stopped.push("api");
      if (failures.stopApi) throw failures.stopApi;
    },
  } as unknown as InProcessApi;
  return {
    statuses,
    stopped,
    services: {
      startProxy: async () => ({
        url: "postgres://probe@127.0.0.1:1/probe_test",
        snapshot: emptyTraffic,
        stop: async () => {
          stopped.push("proxy");
        },
      }),
      startApi: async () => {
        if (failures.startApi) throw failures.startApi;
        return api;
      },
      sourceIdentity: () => ({ revision: "test", dirty: false }),
      saveReport: async (name: string, report: object) => {
        const { status } = report as { status?: unknown };
        statuses.push(status);
        if (status !== "running" && failures.finalSave)
          throw failures.finalSave;
        return `/reports/${name}`;
      },
    },
  };
}

function probe(run: () => Promise<void>) {
  return {
    scenario: "test",
    reportPrefix: "test",
    options: {},
    boundary: "test",
    run: async ({ progress }: { progress: () => Promise<void> }) => {
      await progress();
      await run();
    },
    results: () => ({ measurements: [] }),
  };
}

test("a complete run saves its progress and final report, then stops", async () => {
  const fake = fakeServices();
  await runInProcessProbe(
    probe(async () => undefined),
    fake.services,
  );
  expect(fake.statuses).toEqual(["running", "complete"]);
  expect(fake.stopped.sort()).toEqual(["api", "proxy"]);
});

test("a failed run saves a failed report and keeps its own error", async () => {
  const fake = fakeServices({ finalSave: new Error("disk full") });
  await expect(
    runInProcessProbe(
      probe(async () => {
        throw new Error("measurement failed");
      }),
      fake.services,
    ),
  ).rejects.toThrow("measurement failed");
  expect(fake.statuses).toEqual(["running", "failed"]);
  expect(fake.stopped.sort()).toEqual(["api", "proxy"]);
});

test("an API that fails to start still leaves a failed report", async () => {
  const fake = fakeServices({ startApi: new Error("no database") });
  await expect(
    runInProcessProbe(
      probe(async () => undefined),
      fake.services,
    ),
  ).rejects.toThrow("no database");
  expect(fake.statuses).toEqual(["failed"]);
  expect(fake.stopped).toEqual(["proxy"]);
});

test("a complete run whose report cannot be saved fails", async () => {
  const fake = fakeServices({ finalSave: new Error("disk full") });
  await expect(
    runInProcessProbe(
      probe(async () => undefined),
      fake.services,
    ),
  ).rejects.toThrow("disk full");
  expect(fake.stopped.sort()).toEqual(["api", "proxy"]);
});

test("an API that fails to stop neither hides the error nor keeps the proxy", async () => {
  const fake = fakeServices({ stopApi: new Error("stuck") });
  await expect(
    runInProcessProbe(
      probe(async () => {
        throw new Error("measurement failed");
      }),
      fake.services,
    ),
  ).rejects.toThrow("measurement failed");
  expect(fake.stopped.sort()).toEqual(["api", "proxy"]);
});
