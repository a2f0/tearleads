import { parseArgs } from "node:util";
import { LEGAL_TERMS_VERSION } from "@tearleads/client-sdk";
import { openCloudflareTail } from "./cloudflare";
import { sourceIdentity } from "./database/artifacts";
import { openLocalDatabase } from "./localDatabase";
import { targets } from "./options";
import { saveJson } from "./reportFiles";
import { createSdkHost } from "./sdkHost";
import { runSeedProcess } from "./seedProcess";
import { createMeasuredFetch, type RequestMeasurement } from "./transport";

async function provisionSeedAccount(
  origin: string,
  runId: string,
  requests: RequestMeasurement[],
) {
  const db = await openLocalDatabase();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = createMeasuredFetch({
      fetch: originalFetch,
      origin,
      runId,
      sampleId: `${runId}-1`,
      phase: () => "registration",
      startedAt: performance.now(),
      signal: AbortSignal.timeout(60_000),
      requests,
    });
    const sdk = createSdkHost(origin, runId, db.client);
    try {
      const { seedPhrase } = await sdk.identity.generate();
      // The operator running the probe agrees to the terms for its accounts.
      const account = await sdk.session.registerIdentity({
        acceptedLegalTermsVersion: LEGAL_TERMS_VERSION,
      });
      if (!seedPhrase || !account || "status" in account)
        throw new Error("Registration failed.");
      console.log(`Test account ${account.userId}`);
      return {
        seedPhrase,
        userId: account.userId,
        localSql: { ...db.measurements },
      };
    } finally {
      sdk.dispose();
    }
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
}

async function measure<T>(phase: string, work: () => Promise<T>) {
  const start = performance.now();
  try {
    const value = await work();
    const durationMs = Math.round(performance.now() - start);
    console.log(`${phase} elapsed: ${durationMs} ms`);
    return { value, durationMs };
  } catch (error) {
    console.log(
      `${phase} elapsed: ${Math.round(performance.now() - start)} ms`,
    );
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      env: { type: "string" },
      trace: { type: "boolean" },
      cloudflare: { type: "boolean", default: false },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "bun run perf:seed --env staging|production [--trace] [--cloudflare]\nCreates one persistent test account. Times seeding and fresh-device verification and saves a JSON report.",
    );
    return;
  }
  if (values.env !== "staging" && values.env !== "production")
    throw new Error("Choose --env staging or --env production explicitly.");
  const environment = values.env;
  const target = targets[environment];
  const runId = crypto.randomUUID();
  const requests: RequestMeasurement[] = [];
  const tail = values.cloudflare
    ? await openCloudflareTail(target.worker, runId)
    : null;
  const startedAt = new Date().toISOString();
  try {
    const provisioned = await measure("provision", () =>
      provisionSeedAccount(target.origin, runId, requests),
    );
    const phaseMs: Record<string, number> = {
      provision: provisioned.durationMs,
    };
    const roundTrip = await measure("seed round trip", async () => {
      for (const command of ["seed", "verify-seed"]) {
        const step = await measure(command, async () => {
          await runSeedProcess(
            command,
            [
              process.execPath,
              "src/index.ts",
              command,
              "--key-stdin",
              "--env",
              environment,
              ...(values.trace ? ["--trace"] : []),
            ],
            provisioned.value.seedPhrase,
          );
        });
        phaseMs[command] = step.durationMs;
      }
    });
    phaseMs["seed-round-trip"] = roundTrip.durationMs;
    if (tail) await Bun.sleep(2_000);
    const reportPath = await saveJson(`seed-${runId}.json`, {
      schemaVersion: 1,
      scenario: "continuity-seed-round-trip",
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      environment,
      ...sourceIdentity(),
      userId: provisioned.value.userId,
      phaseMs,
      provisionRequests: requests,
      provisionLocalSql: provisioned.value.localSql,
      ...(tail
        ? {
            cloudflare: {
              events: tail.events,
              warnings: tail.warnings,
            },
          }
        : {}),
    });
    console.log(`Report: ${reportPath}`);
  } finally {
    await tail?.close();
  }
}
if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Seed experiment failed.",
    );
    process.exit(1);
  }
  process.exit(0);
}
