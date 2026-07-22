// Out-of-process Stripe seat reconciliation. The systemd timer runs this every
// minute; DB leases and Stripe idempotency also make manual overlapping runs safe.
import { closeApiDatabase } from "@tearleads/api-shared/postgres";
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
  const summary = await runStripeSeatSynchronization(
    getDefaultApiServiceRuntime(),
    limit === undefined ? {} : { limit },
  );
  console.log(JSON.stringify(summary));
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error("Stripe seat synchronization failed:", error);
  process.exitCode = 1;
} finally {
  await closeApiDatabase();
}
