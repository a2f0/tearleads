import { mock } from "bun:test";
import type { CloudflareApi } from "./cloudflareApi";
import type { prepareDatabaseExperiment } from "./prepare";
import type { runDatabaseExperiment } from "./run";
import type { DatabaseSample } from "./sample";

type PreparedExperiment = Awaited<ReturnType<typeof prepareDatabaseExperiment>>;

export function runFixture() {
  let exists = false;
  const saved: object[] = [];
  const samples: DatabaseSample[] = [];
  const runId = crypto.randomUUID();
  const config = {
    hyperdriveId: "a".repeat(32),
    poolBindings: [],
    placement: { mode: "targeted", target: [1] },
    uploadPlacement: { mode: "targeted", region: "aws:us-east-1" },
    compatibilityDate: "2026-08-17",
    compatibilityFlags: ["nodejs_compat"],
    subdomain: "example",
  };
  const api = mock<CloudflareApi>(async () => (exists ? {} : null));
  const report: PreparedExperiment["report"] = {
    schemaVersion: 1,
    scenario: "database-round-trips",
    runId,
    environment: "staging" as const,
    apiWorker: "tearleads-platform-api-staging",
    worker: "probe",
    expiresAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    revision: "revision",
    dirty: false,
    bundleSha256: "hash",
    configuration: { ...config, queryCacheDisabled: true },
    requestedSamples: 1,
    status: "running",
    cleanup: "not-created",
    samples,
  };
  const prepared: PreparedExperiment = {
    api,
    config,
    report,
    runId,
    name: "probe",
    token: "private",
    expires: Date.now() + 60_000,
    bundle: { blob: new Blob(), sha256: "hash" },
    samples,
    writer: {
      path: "report.json",
      save: async (value) => {
        saved.push(structuredClone(value));
      },
    },
  };
  const close = mock(async () => {
    exists = false;
  });
  const closeTail = mock(async () => {});
  const dependencies = {
    prepare: mock(async () => prepared),
    deploy: mock(async () => {
      exists = true;
      return { origin: "https://probe.test", close };
    }),
    openTail: mock(async () => ({
      events: [],
      warnings: [],
      close: closeTail,
    })),
    ready: mock(async () => {}),
    collectSamples: mock(async () => {}),
  } satisfies NonNullable<Parameters<typeof runDatabaseExperiment>[2]>;
  return { dependencies, close, closeTail, api, saved, report };
}
