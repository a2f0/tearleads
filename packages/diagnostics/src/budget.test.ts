import { expect, test } from "bun:test";
import { createSentryEventBudget } from "./budget";

test("changing pool counters cannot spend the budget for unrelated failures", () => {
  const admit = createSentryEventBudget();
  for (let count = 0; count < 30; count++) {
    expect(
      admit({
        type: undefined,
        tags: {
          api_operation: "http.request",
          api_error_code: "PG_CONNECT_TIMEOUT",
          api_route: "/documents/{documentId}",
          api_pool_total: String(count),
          api_pool_idle: String(count),
          api_pool_waiting: String(count),
          api_connection_attempts: String(count),
        },
      }),
    ).toBe(count === 0);
  }
  expect(
    admit({ type: undefined, tags: { api_operation: "billing.seat-sync" } }),
  ).toBe(true);
  expect(
    admit({ type: undefined, tags: { api_route: "/organizations" } }),
  ).toBe(true);
});
