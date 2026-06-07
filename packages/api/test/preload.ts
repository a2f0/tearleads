import { afterAll } from "bun:test";
import { initializeApiDatabase } from "../src/adapters/postgres";
import { closeApiTestAdapters } from "./cleanup";

await initializeApiDatabase();

afterAll(async () => {
  await closeApiTestAdapters();
});
