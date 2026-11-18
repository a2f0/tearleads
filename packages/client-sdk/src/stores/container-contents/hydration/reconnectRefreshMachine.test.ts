import { expect, test } from "bun:test";
import {
  transitionReconnectRefresh as move,
  type ReconnectRefreshState,
} from "./reconnectRefreshMachine";

test("an acknowledgement replaces the crawl and invalidates its completion and timer", () => {
  const idle = { status: "idle" } as const;
  const first = {};
  const second = {};
  const pending = move(idle, { type: "acknowledged" });
  const crawling = move(pending, { type: "start", crawl: first });
  const waiting = move(crawling, {
    type: "finish",
    crawl: first,
    outcome: "retry",
  });

  for (const previous of [crawling, waiting]) {
    const replacement = move(move(previous, { type: "acknowledged" }), {
      type: "start",
      crawl: second,
    });
    expect(replacement).toEqual({
      status: "crawling",
      crawl: second,
      delayMs: 1_000,
    });
    for (const outcome of ["complete", "refused", "retry"] as const) {
      expect(move(replacement, { type: "finish", crawl: first, outcome })).toBe(
        replacement,
      );
    }
    expect(move(replacement, { type: "retry", crawl: first })).toBe(
      replacement,
    );
    expect(move(replacement, { type: "start", crawl: first })).toBe(
      replacement,
    );
    const settled = move(replacement, {
      type: "finish",
      crawl: second,
      outcome: "complete",
    });
    expect(settled).toEqual(idle);
    expect(move(settled, { type: "start", crawl: first })).toBe(settled);
  }
});

test("each incomplete crawl waits for its own retry, with capped exponential backoff", () => {
  let state: ReconnectRefreshState = move(
    { status: "idle" },
    { type: "acknowledged" },
  );
  for (const delayMs of [
    1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000,
  ]) {
    const crawl = {};
    expect(move(state, { type: "retry", crawl })).toBe(state);
    state = move(state, { type: "start", crawl });
    state = move(state, { type: "finish", crawl, outcome: "retry" });
    expect(state).toEqual({ status: "backoff", crawl, delayMs });
    expect(move(state, { type: "start", crawl })).toBe(state);
    expect(move(state, { type: "retry", crawl: {} })).toBe(state);
    state = move(state, { type: "retry", crawl });
  }
  expect(move(state, { type: "acknowledged" })).toEqual({
    status: "pending",
    delayMs: 1_000,
  });
});

test("a repeatedly refused proof waits for a new signal after two automatic retries", () => {
  let state: ReconnectRefreshState = move(
    { status: "idle" },
    { type: "acknowledged" },
  );
  for (let i = 0; i < 3; i++) {
    const crawl = {};
    state = move(state, { type: "start", crawl });
    state = move(state, { type: "finish", crawl, outcome: "refused" });
    state = move(state, { type: "retry", crawl });
  }
  expect(state.status).toBe("deferred");
  expect(move(state, { type: "runtimeChanged" }).status).toBe("pending");
  expect(move(state, { type: "acknowledged" }).status).toBe("pending");
});
