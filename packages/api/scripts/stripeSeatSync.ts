// Out-of-process billing maintenance. The existing systemd timer runs this
// every minute: due free trials are persisted before Stripe seat reconciliation.
// Row locks, DB predicates, and Stripe idempotency make overlaps safe.
import { closeApiDatabase } from "@tearleads/api-shared/postgres";
import { expireOrganizationTrials } from "../src/services/billing/organizationTrialExpiry";
import { runStripeSeatSynchronization } from "../src/services/billing/stripeSeatSync";
import { getDefaultApiServiceRuntime } from "../src/services/runtime";

function readLimit(args: readonly string[]): number | undefined {
  const index = args.indexOf("--limit");
  if (index < 0 || index + 1 >= args.length) {
    return undefined;
  }
  const value = Number(args[index + 1]);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

async function runMaintenancePhase<T>(
  name: string,
  run: () => Promise<T>,
): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    console.error(`${name} failed:`, error);
    process.exitCode = 1;
    return null;
  }
}

try {
  const limit = readLimit(process.argv.slice(2));
  const runtime = getDefaultApiServiceRuntime();
  const options = limit === undefined ? {} : { limit };
  const trialExpiry = await runMaintenancePhase("Free-trial expiry", () =>
    expireOrganizationTrials(runtime, options),
  );
  const stripeSeatSync = await runMaintenancePhase(
    "Stripe seat synchronization",
    () => runStripeSeatSynchronization(runtime, options),
  );
  console.log(JSON.stringify({ stripeSeatSync, trialExpiry }));
  if ((stripeSeatSync?.failed ?? 0) > 0 || (trialExpiry?.failed ?? 0) > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error("Billing maintenance failed:", error);
  process.exitCode = 1;
} finally {
  await closeApiDatabase();
}
