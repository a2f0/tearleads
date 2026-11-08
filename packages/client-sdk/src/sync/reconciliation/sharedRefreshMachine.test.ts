import { expect, test } from "bun:test";
import {
  QUEUED_SHARED_REFRESH,
  type SharedRefreshState,
  transitionSharedRefresh,
} from "./sharedRefreshMachine";

const running = (waiters: number): SharedRefreshState => ({
  status: "running",
  waiters,
});

test("callers join while queued or running, and the refresh starts once", () => {
  const joined = transitionSharedRefresh(QUEUED_SHARED_REFRESH, {
    type: "joined",
  });
  expect(joined).toEqual({ status: "queued", waiters: 1 });
  const started = transitionSharedRefresh(joined, { type: "started" });
  expect(started).toEqual(running(1));
  expect(transitionSharedRefresh(started, { type: "joined" })).toEqual(
    running(2),
  );
  expect(transitionSharedRefresh(started, { type: "started" })).toBe(started);
});

test("the refresh stops only when its last caller withdraws", () => {
  expect(transitionSharedRefresh(running(2), { type: "withdrew" })).toEqual(
    running(1),
  );
  expect(transitionSharedRefresh(running(1), { type: "withdrew" })).toEqual({
    status: "stopping",
  });
  expect(
    transitionSharedRefresh(
      { status: "queued", waiters: 1 },
      { type: "withdrew" },
    ),
  ).toEqual({ status: "stopping" });
});

// A refresh every caller left before it began must never run, and nothing
// joins a refresh that is stopping or settled.
test("a stopping or settled refresh neither starts nor takes callers", () => {
  const stopping: SharedRefreshState = { status: "stopping" };
  expect(transitionSharedRefresh(stopping, { type: "started" })).toBe(stopping);
  expect(transitionSharedRefresh(stopping, { type: "joined" })).toBe(stopping);
  const settled = transitionSharedRefresh(running(1), { type: "settled" });
  expect(settled).toEqual({ status: "settled" });
  expect(transitionSharedRefresh(settled, { type: "joined" })).toBe(settled);
  expect(transitionSharedRefresh(settled, { type: "withdrew" })).toBe(settled);
});
