#!/usr/bin/env bun
// Intentionally explicit: a reset is not a retryable deployment workflow.
import { resolve } from "node:path";
import {
  baseline,
  bindConnection,
  databaseCheck,
  emptyBucket,
  inventory,
  publicHealth,
  recordInventory,
  sameInventory,
} from "./softResetChecks";
import { applyPlan, type Identity, parse, savedPlan } from "./softResetPlans";
import type { InterruptPolicy } from "./softResetProcessState";
import { ResetRun, refuseOverrides } from "./softResetRuntime";

async function preflight(run: ResetRun) {
  const buildCheck = (mode: string) =>
    run.exec(
      ["bash", "scripts/deploy/softResetPreflight.sh", run.tier, mode],
      mode === "api" ? "terraform-state" : "bounded-command",
    );
  const identity = await run.step("credentials", async () => {
    refuseOverrides(run);
    baseline(run);
    const { account, organization, domain } = parse(
      await buildCheck("credentials"),
    );
    if (
      typeof account !== "string" ||
      !account ||
      typeof organization !== "string" ||
      !organization ||
      typeof domain !== "string" ||
      !domain
    )
      throw new Error("Missing configured resource identity.");
    return { account, organization, domain };
  });
  const before = await run.step("inventory", async () => {
    const snapshot = await inventory(run, identity);
    recordInventory(run, "before", snapshot);
    await publicHealth(run, snapshot.urls);
    return snapshot;
  });
  await run.step("drift-postgres", async () =>
    bindConnection(
      before,
      (await savedPlan(run, identity, "postgres", "no-op")).json,
    ),
  );
  await run.step("drift-storage", () =>
    savedPlan(run, identity, "storage", "no-op"),
  );
  await run.step("data-access", async () => {
    await databaseCheck(run, before.connection, "reachable");
    await emptyBucket(run, before.storage, false);
  });
  const postgres = await run.step("plan-destroy-postgres", () =>
    savedPlan(run, identity, "postgres", "delete"),
  );
  const storage = await run.step("plan-destroy-storage", () =>
    savedPlan(run, identity, "storage", "delete"),
  );
  await run.step("runtime-build", () =>
    run.exec(["bun", "run", "build:runtime"], "bounded-command"),
  );
  await run.step("devkit-config", () =>
    run.exec(
      ["bun", "run", "--cwd", "packages/app-electrobun", "prepare:devkit"],
      "bounded-command",
    ),
  );
  await run.step("website-readiness", async () => {
    try {
      await buildCheck("website");
    } catch {
      throw new Error(
        "Website readiness failed; inspect private logs. For stale/incomplete provenance use the shared take-screenshots workflow before starting a new authorized run.",
      );
    }
  });
  await run.step("web-readiness", () => buildCheck("web"));
  await run.step("api-readiness", () => buildCheck("api"));
  return { identity, before, postgres, storage };
}

async function verifyFresh(
  run: ResetRun,
  identity: Identity,
  before: Awaited<ReturnType<typeof inventory>>,
) {
  const snapshot = await inventory(run, identity);
  if (snapshot.database.branch_id === before.database.branch_id)
    throw new Error("Database branch was not replaced.");
  bindConnection(
    snapshot,
    (await savedPlan(run, identity, "postgres", "no-op")).json,
  );
  await databaseCheck(run, snapshot.connection, "empty");
  await emptyBucket(run, snapshot.storage);
  recordInventory(run, "after", snapshot);
  return snapshot;
}

function commandHelpers(run: ResetRun) {
  const helper = (policy: InterruptPolicy, path: string, ...args: string[]) =>
    run.exec([path, run.tier, ...args], policy);
  const teardown = (policy: InterruptPolicy, path: string, ...args: string[]) =>
    run.exec([path, run.tier, ...args], policy, {
      TEARLEADS_TEARDOWN_TIER: run.tier,
    });
  return { helper, teardown };
}

async function reset(run: ResetRun) {
  const { identity, before, postgres, storage } = await preflight(run);
  const { helper, teardown } = commandHelpers(run);
  // This existing helper retires DOs/crons and drains for 930s. Never replace
  // it with wrangler delete (which also detaches the custom domain).
  await run.step("maintenance", () =>
    teardown("bounded-command", "packages/api/scripts/deployApiMaintenance.sh"),
  );
  await run.step("recheck-identities", async () =>
    sameInventory(before, await inventory(run, identity)),
  );
  await run.step("drop-owned", () =>
    teardown("terraform-state", "terraform/scripts/drop-postgres-owned.sh"),
  );
  await run.step("verify-dropped", () =>
    databaseCheck(run, before.connection, "empty"),
  );
  await run.step("destroy-postgres", () =>
    applyPlan(run, "postgres", postgres),
  );
  await run.step("empty-blobs", async () => {
    const current = parse(
      await helper(
        "terraform-state",
        "terraform/scripts/run-storage-stack.sh",
        "output",
        "-json",
        "api_storage",
      ),
    );
    if (JSON.stringify(current) !== JSON.stringify(before.storage))
      throw new Error("Blob credentials/identity changed.");
    await teardown(
      "terraform-state",
      "terraform/scripts/empty-r2-bucket.sh",
      "storage",
    );
    await emptyBucket(run, current);
  });
  await run.step("destroy-storage", () => applyPlan(run, "storage", storage));
  await run.step("create-postgres", async () =>
    applyPlan(
      run,
      "postgres",
      await savedPlan(run, identity, "postgres", "create"),
    ),
  );
  await run.step("create-storage", async () =>
    applyPlan(
      run,
      "storage",
      await savedPlan(run, identity, "storage", "create"),
    ),
  );
  const after = await run.step("verify-fresh", () =>
    verifyFresh(run, identity, before),
  );
  await run.step("deploy-api", () =>
    helper("terraform-state", "packages/api/scripts/deployApi.sh"),
  );
  await run.step("verify-api", () =>
    helper("bounded-command", "packages/api/scripts/verifyApi.sh"),
  );
  await run.step("verify-schema", () =>
    databaseCheck(run, after.connection, "baseline"),
  );
  await run.step("deploy-app-demo", () =>
    helper("bounded-command", "packages/app-web/scripts/deployAppWeb.sh"),
  );
  await run.step("deploy-website", () =>
    helper(
      "bounded-command",
      "packages/website/scripts/deployWebsite.sh",
      "--skip-terraform",
    ),
  );
  await run.step("verify-public", async () => {
    sameInventory(after, await inventory(run, identity));
    await publicHealth(run, after.urls);
  });
}
const args = process.argv.slice(2);
const tier = args[0];
const preview =
  args.length === 0 ||
  (args.length === 1 && ["--help", "-h"].includes(tier ?? "")) ||
  ((tier === "prod" || tier === "staging") &&
    (args.length === 1 || (args.length === 2 && args[1] === "--preview")));
const apply =
  (tier === "prod" || tier === "staging") &&
  args.length === 4 &&
  args[1] === "--apply" &&
  args[2] === "--confirm" &&
  args[3] === `RESET ${tier} APPLICATION DATA`;
if (!preview && !apply) {
  console.error(
    'Invalid authorization: use bun run soft-reset <prod|staging> --apply --confirm "RESET <tier> APPLICATION DATA".',
  );
  process.exit(1);
}
if (apply && (tier === "prod" || tier === "staging")) {
  let run: ResetRun | undefined;
  let success = false;
  try {
    run = new ResetRun(resolve(import.meta.dir, "../.."), tier);
    await reset(run);
    success = true;
  } catch (error) {
    // Provider stdout/stderr and parse errors stay private, never interpolate
    // their bodies into terminal diagnostics.
    console.error(
      error instanceof SyntaxError
        ? "Invalid provider JSON; inspect private logs."
        : error instanceof Error
          ? error.message
          : "Reset failed.",
    );
  } finally {
    process.exitCode = run ? await run.finish(success) : 1;
  }
} else
  console.log(`PREVIEW — no credentials loaded and no cloud calls.
Usage: bun run soft-reset [prod|staging] [--preview]
       bun run soft-reset <prod|staging> --apply --confirm "RESET <tier> APPLICATION DATA"

Preflight clean source, identities, plans, screenshots and web builds.
Deploy API maintenance in place and enforce its 930-second drain.
Drop owned application objects; recreate PostgreSQL and application blob R2.
Deploy API (migrations), verify schema/empty data, deploy app/demo and website.
Verify public health without creating accounts. Record step and total timings.
No native mobile/desktop builds or releases. Hostnames and downloads stay intact.
Failures preserve a blocking lock; recovery is manual, never a blind rerun.`);
