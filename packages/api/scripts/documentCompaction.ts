// Out-of-process trigger for document storage compaction: reclaim the encrypted
// payload of pre-rotation document updates that a rotate_baseline already
// dominates (the row and its attribution metadata are retained). Run on demand
// or from a scheduler (systemd timer / cron); nothing schedules it in the app
// process. Usage: API_DATABASE=postgres bun packages/api/scripts/documentCompaction.ts
//   [--limit <n>]
import { closeApiDatabase } from "@tearleads/api-shared/postgres";
import { runDocumentCompaction } from "../src/services/documents/documentCompaction";
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
  const summary = await runDocumentCompaction(defaultApiServiceRuntime, {
    ...(limit !== undefined ? { limit } : {}),
  });
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  // Report failures so a cron/systemd run is detectable as failed.
  console.error("Document compaction failed:", error);
  process.exitCode = 1;
} finally {
  await closeApiDatabase();
}
