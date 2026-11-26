import { cpus } from "node:os";
import { sourceIdentity } from "./database/artifacts";
import { saveJson } from "./realtime/artifacts";
import { type InProcessApi, startInProcessApi } from "./realtime/inProcessApi";
import {
  parseLocalDatabaseUrl,
  startPostgresProxy,
} from "./realtime/postgresProxy";
import type { PostgresTraffic } from "./realtime/postgresWire";

export interface InProcessProbeContext {
  readonly api: InProcessApi;
  /** The local database's name, from `DATABASE_URL`. */
  readonly database: string;
  readonly traffic: () => PostgresTraffic;
  /** Rewrites the report with the results so far. */
  readonly progress: () => Promise<void>;
}

/** The fields every report starts with; a probe's results cannot replace them. */
type HeaderField =
  | "schemaVersion"
  | "scenario"
  | "runId"
  | "startedAt"
  | "database"
  | "options"
  | "boundary"
  | "revision"
  | "dirty"
  | "runtime"
  | "updatedAt"
  | "status";

/** A probe's own report fields, which may not name a header field. */
type ProbeResults = Readonly<Record<string, unknown>> & {
  readonly [field in HeaderField]?: never;
};

/** A report: the run's header, then the probe's own results. */
export function probeReport(
  header: Readonly<Record<HeaderField, unknown>>,
  results: ProbeResults,
): Record<string, unknown> {
  const reserved = Object.keys(header).filter((field) => field in results);
  if (reserved.length > 0)
    throw new Error(`Probe results cannot set ${reserved.join(", ")}.`);
  return { ...header, ...results };
}

/** What a run starts and writes; tests replace them. */
interface ProbeServices {
  readonly startProxy: (target: URL) => Promise<{
    readonly url: string;
    readonly snapshot: () => PostgresTraffic;
    readonly stop: () => Promise<void>;
  }>;
  readonly startApi: () => Promise<InProcessApi>;
  readonly saveReport: (name: string, report: object) => Promise<string>;
}

const services: ProbeServices = {
  startProxy: startPostgresProxy,
  startApi: startInProcessApi,
  saveReport: (name, report) => saveJson(name, report),
};

/** Stops what a run started, each whatever the other does. */
async function stopAll(stops: readonly (Promise<void> | undefined)[]) {
  for (const result of await Promise.allSettled(stops))
    if (result.status === "rejected")
      console.error(`A probe service did not stop: ${String(result.reason)}`);
}

/**
 * Boots the API in this process against the local database named by
 * `DATABASE_URL`, through a counting proxy, and runs the probe. The report
 * is saved whenever the probe reports progress and once more when the run
 * ends, however it ends.
 */
export async function runInProcessProbe(
  input: {
    readonly scenario: string;
    readonly reportPrefix: string;
    readonly options: object;
    /** What the measurement does and does not stand for. */
    readonly boundary: string;
    readonly run: (context: InProcessProbeContext) => Promise<void>;
    /** The report's own fields, read at every save. */
    readonly results: () => ProbeResults;
  },
  { startProxy, startApi, saveReport }: ProbeServices = services,
): Promise<void> {
  const { DATABASE_URL: databaseUrl } = process.env;
  const target = parseLocalDatabaseUrl(databaseUrl);
  const database = decodeURIComponent(target.pathname.slice(1));
  // Read before anything starts, so a failure here leaves nothing running.
  const source = sourceIdentity();
  const proxy = await startProxy(target);
  // The API reads its database configuration when it loads.
  Object.assign(process.env, {
    API_DATABASE: "postgres",
    DATABASE_URL: proxy.url,
  });
  const runId = crypto.randomUUID();
  const reportName = `${input.reportPrefix}-${runId}.json`;
  const metadata = {
    schemaVersion: 1,
    scenario: input.scenario,
    runId,
    startedAt: new Date().toISOString(),
    database,
    options: input.options,
    boundary: input.boundary,
    ...source,
    runtime: {
      bun: Bun.version,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model ?? null,
    },
  };
  const save = (status: "running" | "complete" | "failed") =>
    saveReport(
      reportName,
      probeReport(
        { ...metadata, updatedAt: new Date().toISOString(), status },
        input.results(),
      ),
    );
  let api: InProcessApi | undefined;
  let outcome:
    | { readonly status: "complete" }
    | { readonly status: "failed"; readonly error: unknown };
  try {
    api = await startApi();
    await input.run({
      api,
      database,
      traffic: proxy.snapshot,
      progress: async () => {
        await save("running");
      },
    });
    outcome = { status: "complete" };
  } catch (error) {
    outcome = { status: "failed", error };
  }
  try {
    console.log(`Report: ${await save(outcome.status)}`);
  } catch (error) {
    // A failed run's own error matters more than its report.
    if (outcome.status === "complete") outcome = { status: "failed", error };
    else console.error(`The report was not saved: ${String(error)}`);
  } finally {
    await stopAll([api?.stop(), proxy.stop()]);
  }
  if (outcome.status === "failed") throw outcome.error;
}
