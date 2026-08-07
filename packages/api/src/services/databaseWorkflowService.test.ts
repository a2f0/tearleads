import { expect, test } from "bun:test";
import { createServiceTestRuntime } from "../../test/helpers/serviceRuntime";
import { createDatabaseWorkflowService } from "./databaseWorkflowService";
import type { ApiServiceRuntime } from "./runtime";

test("database workflow services select the runtime database", async () => {
  const runtime = createServiceTestRuntime();
  const input = { value: "input" };
  const result = { value: "result" };
  let receivedDb: ApiServiceRuntime["db"] | undefined;

  const service = createDatabaseWorkflowService(
    async (database, receivedInput) => {
      receivedDb = database;
      expect(receivedInput).toBe(input);
      return result;
    },
  );

  expect(await service(runtime, input)).toBe(result);
  expect(receivedDb).toBe(runtime.db);
});
