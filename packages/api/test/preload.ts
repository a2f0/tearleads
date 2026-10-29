import { afterAll } from "bun:test";

const [
  { initializeApiDatabase },
  { resetKeyValueStore },
  { closeApiTestAdapters },
] = await Promise.all([
  import("@tearleads/api-shared/postgres"),
  import("../src/adapters/keyValueStore"),
  import("./cleanup"),
]);

await initializeApiDatabase();
resetKeyValueStore();

// A serial run calls a preload's afterAll once, after the last file. A
// `--parallel` worker (which sets BUN_TEST_WORKER_ID) calls it after every
// file, and without isolation the worker's next file reuses this module graph
// and its database, so closing here would hand that file a closed PGlite. A
// worker ends with the run, which releases its in-memory database.
const runsAfterAllPerFile = "BUN_TEST_WORKER_ID" in process.env;

afterAll(async () => {
  if (runsAfterAllPerFile) {
    return;
  }
  await closeApiTestAdapters();
});
