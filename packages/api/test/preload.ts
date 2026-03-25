import { afterAll } from "bun:test";
import pgClient from "../src/adapters/postgres";

afterAll(async () => {
  await pgClient.close();
});
