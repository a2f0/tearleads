import { expect, test } from "bun:test";
import { shouldRefreshDataUsageAfterSync } from "./useOrgManagerDataUsageRefresh";

test("usage refresh waits for visible sync work to settle", () => {
  expect(
    shouldRefreshDataUsageAfterSync({
      enabled: true,
      pending: false,
      previouslyPending: true,
      visible: true,
    }),
  ).toBe(true);
  expect(
    shouldRefreshDataUsageAfterSync({
      enabled: true,
      pending: true,
      previouslyPending: false,
      visible: true,
    }),
  ).toBe(false);
  expect(
    shouldRefreshDataUsageAfterSync({
      enabled: true,
      pending: false,
      previouslyPending: true,
      visible: false,
    }),
  ).toBe(false);
  expect(
    shouldRefreshDataUsageAfterSync({
      enabled: false,
      pending: false,
      previouslyPending: true,
      visible: true,
    }),
  ).toBe(false);
});
