import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { openLocalDatabase } from "./localDatabase";
import { targets } from "./options";
import { createSdkHost } from "./sdkHost";
import { createMeasuredFetch } from "./transport";

async function provisionSeedAccount(origin: string) {
  const db = await openLocalDatabase();
  const originalFetch = globalThis.fetch;
  const id = crypto.randomUUID();
  try {
    globalThis.fetch = createMeasuredFetch({
      fetch: originalFetch,
      origin,
      runId: id,
      sampleId: "seed",
      phase: () => "registration",
      startedAt: performance.now(),
      signal: AbortSignal.timeout(60_000),
      requests: [],
    });
    const sdk = createSdkHost(origin, id, db.client);
    try {
      const { seedPhrase } = await sdk.identity.generate();
      await sdk.session.bootstrapLocalRootContainer();
      const account = await sdk.session.registerIdentity();
      if (!seedPhrase || !account || "status" in account)
        throw new Error("Registration failed.");
      console.log(`Test account ${account.userId}`);
      return seedPhrase;
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
    return await work();
  } finally {
    console.log(
      `${phase} elapsed: ${Math.round(performance.now() - start)} ms`,
    );
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      env: { type: "string" },
      trace: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "bun run perf:seed --env staging|production [--trace]\nCreates one persistent test account. Times seeding and fresh-device verification.",
    );
    return;
  }
  if (values.env !== "staging" && values.env !== "production")
    throw new Error("Choose --env staging or --env production explicitly.");
  const environment = values.env;
  const key = await measure("provision", () =>
    provisionSeedAccount(targets[environment].origin),
  );
  await measure("seed round trip", async () => {
    for (const command of ["seed", "verify-seed"]) {
      await measure(command, async () => {
        const child = Bun.spawn(
          [
            process.execPath,
            "run",
            "tearleads",
            command,
            "--key-stdin",
            "--env",
            environment,
            ...(values.trace ? ["--trace"] : []),
          ],
          {
            cwd: fileURLToPath(new URL("../../../", import.meta.url)),
            stdin: new TextEncoder().encode(key),
            stdout: "inherit",
            stderr: "inherit",
            // Verification allows an hour for discovery plus per-document reads and logout.
            signal: AbortSignal.timeout(
              (command === "verify-seed" ? 120 : 30) * 60_000,
            ),
          },
        );
        if ((await child.exited) !== 0) throw new Error(`${command} failed.`);
      });
    }
  });
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
