// Out-of-process trigger for blob storage reclamation: reclaim blobs that purge
// soft-deleted past the grace period and clean up expired stage uploads. Run on
// demand or from a scheduler (systemd timer / cron); nothing schedules it in the
// app process. Usage: API_DATABASE=postgres bun packages/api/scripts/blobGc.ts
//   [--grace-ms <n>] [--limit <n>]
import { closeApiDatabase } from "@tearleads/api-shared/postgres";
import { runBlobMaintenance } from "../src/services/blobs/blobMaintenance";
import { getDefaultApiServiceRuntime } from "../src/services/runtime";

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
const gracePeriodMs = readNumericFlag(args, "--grace-ms");
const limit = readNumericFlag(args, "--limit");

try {
  const summary = await runBlobMaintenance(getDefaultApiServiceRuntime(), {
    dereferencedBlobs: {
      ...(gracePeriodMs !== undefined ? { gracePeriodMs } : {}),
      ...(limit !== undefined ? { limit } : {}),
    },
    expiredStages: {
      ...(limit !== undefined ? { limit } : {}),
    },
  });
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  // Report failures so a cron/systemd run is detectable as failed.
  console.error("Blob GC maintenance failed:", error);
  process.exitCode = 1;
} finally {
  await closeApiDatabase();
}
