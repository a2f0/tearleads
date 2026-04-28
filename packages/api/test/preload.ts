import { afterAll } from "bun:test";
import { closeApiTestAdapters } from "./cleanup";

afterAll(async () => {
  await closeApiTestAdapters();
});
