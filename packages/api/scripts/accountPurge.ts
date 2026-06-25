// Out-of-process trigger for account data purge. It deletes remote sync data for
// disabled accounts whose purge window has elapsed, while retaining the user/key
// row for future payment-driven reactivation.
// Usage: API_DATABASE=postgres bun packages/api/scripts/accountPurge.ts [--limit <n>]
import { closeApiDatabase } from "@tearleads/api-shared/postgres";
import { runAccountPurgeMaintenance } from "../src/services/accounts/purge";
import { defaultApiServiceRuntime } from "../src/services/runtime";

function readNumericFlag(
  args: readonly string[],
  flag: string,
): number | undefined {
  const index = args.indexOf(flag);
  if (index < 0 || index + 1 >= args.length) {
    return undefined;
  }
  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : undefined;
}

const args = process.argv.slice(2);
const limit = readNumericFlag(args, "--limit");

try {
  const summary = await runAccountPurgeMaintenance(defaultApiServiceRuntime, {
    ...(limit !== undefined ? { limit } : {}),
  });
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error("Account purge failed:", error);
  process.exitCode = 1;
} finally {
  await closeApiDatabase();
}
