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

try {
  const limit = readLimit(process.argv.slice(2));
  const runtime = getDefaultApiServiceRuntime();
  const options = limit === undefined ? {} : { limit };
  const trialExpiry = await expireOrganizationTrials(runtime, options);
  const stripeSeatSync = await runStripeSeatSynchronization(runtime, options);
  console.log(JSON.stringify({ stripeSeatSync, trialExpiry }));
  if (stripeSeatSync.failed > 0 || trialExpiry.failed > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error("Billing maintenance failed:", error);
  process.exitCode = 1;
} finally {
  await closeApiDatabase();
}
