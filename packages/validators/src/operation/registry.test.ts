import { expect, test } from "bun:test";
import { protocolOperations } from "./registry";

test("every routed operation declares the global database-unavailable response", () => {
  for (const operation of protocolOperations) {
    expect(operation.failureStatuses).toContain(503);
    expect(
      operation.failureResponses[503]?.safeParse({
        error: "Database temporarily unavailable",
      }).success,
    ).toBe(true);
  }
});
