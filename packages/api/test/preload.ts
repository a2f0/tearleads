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

afterAll(async () => {
  await closeApiTestAdapters();
});
