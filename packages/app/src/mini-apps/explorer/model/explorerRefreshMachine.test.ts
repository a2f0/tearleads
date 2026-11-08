import { expect, test } from "bun:test";
import {
  type ExplorerRefreshState,
  IDLE_EXPLORER_REFRESH,
  transitionExplorerRefresh,
} from "./explorerRefreshMachine";

const run = {};
const refreshing: ExplorerRefreshState = { status: "refreshing", request: run };
const failed: ExplorerRefreshState = { message: "Failed.", status: "failed" };

test("a refresh starts from idle or after a failure, one at a time", () => {
  const next = {};
  expect(
    transitionExplorerRefresh(IDLE_EXPLORER_REFRESH, {
      request: next,
      type: "started",
    }),
  ).toEqual({ request: next, status: "refreshing" });
  expect(
    transitionExplorerRefresh(failed, { request: next, type: "started" }),
  ).toEqual({ request: next, status: "refreshing" });
  expect(
    transitionExplorerRefresh(refreshing, { request: next, type: "started" }),
  ).toBe(refreshing);
});

test("the running refresh settles idle, or failed with its message", () => {
  for (const type of ["succeeded", "interrupted", "cancelled"] as const) {
    expect(transitionExplorerRefresh(refreshing, { request: run, type })).toBe(
      IDLE_EXPLORER_REFRESH,
    );
  }
  expect(
    transitionExplorerRefresh(refreshing, {
      message: "Failed.",
      request: run,
      type: "failed",
    }),
  ).toEqual(failed);
});

// A cancelled or replaced run settles later; its outcome must not override
// what the user sees now.
test("a stale run's outcome is ignored", () => {
  const stale = {};
  for (const state of [IDLE_EXPLORER_REFRESH, failed, refreshing]) {
    expect(
      transitionExplorerRefresh(state, {
        message: "Failed.",
        request: stale,
        type: "failed",
      }),
    ).toBe(state);
    expect(
      transitionExplorerRefresh(state, { request: stale, type: "succeeded" }),
    ).toBe(state);
  }
});
