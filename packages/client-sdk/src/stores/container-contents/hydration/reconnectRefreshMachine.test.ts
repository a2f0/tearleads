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
      refusals: 0,
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
    expect(state).toEqual({ status: "backoff", crawl, delayMs, refusals: 0 });
    expect(move(state, { type: "start", crawl })).toBe(state);
    expect(move(state, { type: "retry", crawl: {} })).toBe(state);
    state = move(state, { type: "retry", crawl });
  }
  expect(move(state, { type: "acknowledged" })).toEqual({
    status: "pending",
    delayMs: 1_000,
    refusals: 0,
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

test("disposal invalidates both a timer and a crawl, and a runtime change replaces an active crawl", () => {
  const crawl = {};
  const running = move(move({ status: "idle" }, { type: "acknowledged" }), {
    type: "start",
    crawl,
  });
  const waiting = move(running, { type: "finish", crawl, outcome: "retry" });
  for (const state of [running, waiting]) {
    const disposed = move(state, { type: "disposed" });
    expect(disposed.status).toBe("disposed");
    expect(move(disposed, { type: "finish", crawl, outcome: "retry" })).toBe(
      disposed,
    );
    expect(move(disposed, { type: "retry", crawl })).toBe(disposed);
    expect(move(disposed, { type: "acknowledged" })).toBe(disposed);
    const replacement = move(state, { type: "runtimeChanged" });
    expect(replacement.status).toBe("pending");
    expect(
      move(replacement, { type: "finish", crawl, outcome: "refused" }),
    ).toBe(replacement);
  }
});

test("listing failures do not use the next proof's retry attempts", () => {
  let state: ReconnectRefreshState = move(
    { status: "idle" },
    { type: "acknowledged" },
  );
  for (const outcome of ["retry", "retry", "refused", "refused"] as const) {
    const crawl = {};
    state = move(state, { type: "start", crawl });
    state = move(state, { type: "finish", crawl, outcome });
    expect(state.status).toBe("backoff");
    state = move(state, { type: "retry", crawl });
  }
});
