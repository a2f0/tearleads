import { expect, test } from "bun:test";
import {
  type AttributionReadState,
  currentAttributionResult,
  hasAttributionReadSettled,
  heldAttributionResult,
  transitionAttributionRead,
} from "./attributionReadMachine";

type State = AttributionReadState<string>;

const scopeA = {};
const scopeB = {};
function request(scope: object, documentId = "doc") {
  return { documentId, scope };
}

test("replacement requests discard old identities and cannot finish out of order", () => {
  const first = request(scopeA, "doc-1");
  const next = request(scopeB, "doc-2");
  const loading = transitionAttributionRead<string>(
    { status: "idle" },
    { type: "request", request: first },
  );
  expect(loading).toEqual({
    status: "loading",
    request: first,
    previous: null,
    refreshing: false,
  });
  const ready = transitionAttributionRead(loading, {
    type: "loaded",
    request: first,
    result: "a",
  });
  expect(ready).toEqual({ status: "ready", request: first, result: "a" });
  const replacement = transitionAttributionRead(ready, {
    type: "request",
    request: next,
  });
  // Another scope: nothing of the first read is carried.
  expect(replacement).toEqual({
    status: "loading",
    request: next,
    previous: null,
    refreshing: false,
  });
  expect(
    transitionAttributionRead(replacement, {
      type: "loaded",
      request: first,
      result: "stale",
    }),
  ).toBe(replacement);
  expect(
    transitionAttributionRead(replacement, { type: "failed", request: first }),
  ).toBe(replacement);
  expect(
    transitionAttributionRead(replacement, { type: "failed", request: next }),
  ).toEqual({ status: "unavailable", request: next, previous: null });
  const idle = transitionAttributionRead(replacement, {
    type: "request",
    request: null,
  });
  expect(idle).toEqual({ status: "idle" });
  expect(
    transitionAttributionRead(idle, {
      type: "loaded",
      request: next,
      result: "late",
    }),
  ).toBe(idle);
});

test("reset and restart for the same document require a new request identity", () => {
  const oldRequest = request(scopeA);
  const newRequest = request(scopeA);
  const reset = transitionAttributionRead<string>(
    {
      status: "loading",
      request: oldRequest,
      previous: null,
      refreshing: false,
    },
    { type: "request", request: null },
  );
  const current = transitionAttributionRead(reset, {
    type: "request",
    request: newRequest,
  });
  Object.freeze(current);
  expect(
    transitionAttributionRead(current, {
      type: "loaded",
      request: oldRequest,
      result: "stale",
    }),
  ).toBe(current);
  expect(
    transitionAttributionRead(current, { type: "failed", request: oldRequest }),
  ).toBe(current);
  expect(
    transitionAttributionRead(current, {
      type: "loaded",
      request: newRequest,
      result: "fresh",
    }),
  ).toEqual({ status: "ready", request: newRequest, result: "fresh" });
});

test("settled requests ignore duplicate completions and can restart or reset", () => {
  const settled = request(scopeA);
  const states: State[] = [
    { status: "idle" },
    { status: "ready", request: settled, result: "a" },
    { status: "unavailable", request: settled, previous: null },
  ];
  for (const state of states) {
    Object.freeze(state);
    expect(
      transitionAttributionRead(state, {
        type: "loaded",
        request: settled,
        result: "late",
      }),
    ).toBe(state);
    expect(
      transitionAttributionRead(state, { type: "failed", request: settled }),
    ).toBe(state);
    expect(
      transitionAttributionRead(state, { type: "request", request: null }),
    ).toEqual({ status: "idle" });
  }
});

// What a refresh keeps: the latest result read in its own scope, through
// loading and failure, until its own result replaces it.
const refreshTable: ReadonlyArray<{
  name: string;
  state: State;
  scope: object;
  previous: string | null;
  refreshing: boolean;
}> = [
  {
    name: "nothing read yet",
    state: { status: "idle" },
    scope: scopeA,
    previous: null,
    refreshing: false,
  },
  {
    name: "a ready read, same scope",
    state: { status: "ready", request: request(scopeA), result: "a" },
    scope: scopeA,
    previous: "a",
    refreshing: true,
  },
  {
    name: "a ready read, another scope",
    state: { status: "ready", request: request(scopeA), result: "a" },
    scope: scopeB,
    previous: null,
    refreshing: false,
  },
  {
    name: "a refresh still loading, same scope",
    state: {
      status: "loading",
      request: request(scopeA),
      previous: "a",
      refreshing: true,
    },
    scope: scopeA,
    previous: "a",
    refreshing: true,
  },
  {
    name: "a first read still loading, same scope",
    state: {
      status: "loading",
      request: request(scopeA),
      previous: null,
      refreshing: false,
    },
    scope: scopeA,
    previous: null,
    refreshing: false,
  },
  {
    name: "a refresh still loading, another scope",
    state: {
      status: "loading",
      request: request(scopeA),
      previous: "a",
      refreshing: true,
    },
    scope: scopeB,
    previous: null,
    refreshing: false,
  },
  {
    name: "a refresh that failed, same scope",
    state: { status: "unavailable", request: request(scopeA), previous: "a" },
    scope: scopeA,
    previous: "a",
    refreshing: true,
  },
  {
    name: "a first read that failed, same scope",
    state: { status: "unavailable", request: request(scopeA), previous: null },
    scope: scopeA,
    previous: null,
    // Nothing was read, but the scope's first read has settled.
    refreshing: true,
  },
];

for (const row of refreshTable) {
  test(`a new request keeps what it refreshes: ${row.name}`, () => {
    const next = request(row.scope);
    const loading = transitionAttributionRead(row.state, {
      type: "request",
      request: next,
    });
    expect(loading).toEqual({
      status: "loading",
      request: next,
      previous: row.previous,
      refreshing: row.refreshing,
    });
    expect(hasAttributionReadSettled(loading, next)).toBe(row.refreshing);
    // A failure keeps it; a result replaces it.
    expect(
      transitionAttributionRead(loading, { type: "failed", request: next }),
    ).toEqual({ status: "unavailable", request: next, previous: row.previous });
    expect(
      transitionAttributionRead(loading, {
        type: "loaded",
        request: next,
        result: "b",
      }),
    ).toEqual({ status: "ready", request: next, result: "b" });
  });
}

test("a current reader sees only its own request's result", () => {
  const own = request(scopeA);
  const older = request(scopeA);
  const ready: State = { status: "ready", request: own, result: "a" };

  expect(currentAttributionResult(ready, own)).toBe("a");
  // The render before an effect requests the refresh, and a refresh loading.
  expect(currentAttributionResult(ready, request(scopeA))).toBeNull();
  expect(
    currentAttributionResult(
      { status: "loading", request: own, previous: "a", refreshing: true },
      own,
    ),
  ).toBeNull();
  expect(
    currentAttributionResult(
      { status: "ready", request: older, result: "a" },
      own,
    ),
  ).toBeNull();
  expect(currentAttributionResult(ready, null)).toBeNull();
});

test("a held reader sees the latest result in its scope, never another's", () => {
  const own = request(scopeA);
  const ready: State = { status: "ready", request: own, result: "a" };

  expect(heldAttributionResult(ready, own)).toBe("a");
  // The render before an effect requests the refresh of the same scope.
  expect(heldAttributionResult(ready, request(scopeA))).toBe("a");
  expect(
    heldAttributionResult(
      { status: "loading", request: own, previous: "a", refreshing: true },
      own,
    ),
  ).toBe("a");
  expect(
    heldAttributionResult(
      { status: "unavailable", request: own, previous: "a" },
      own,
    ),
  ).toBe("a");
  // Another document or session, even in its first render; and no request.
  expect(heldAttributionResult(ready, request(scopeB))).toBeNull();
  expect(heldAttributionResult(ready, null)).toBeNull();
  expect(heldAttributionResult({ status: "idle" }, own)).toBeNull();
});

test("a scope has settled once its first read loads or fails", () => {
  const first = request(scopeA);
  const loading = transitionAttributionRead<string>(
    { status: "idle" },
    { type: "request", request: first },
  );

  // Nothing to read is not a read that settled.
  expect(hasAttributionReadSettled(loading, null)).toBe(false);
  expect(hasAttributionReadSettled({ status: "idle" }, first)).toBe(false);
  expect(hasAttributionReadSettled(loading, first)).toBe(false);
  for (const settled of [
    transitionAttributionRead(loading, { type: "failed", request: first }),
    transitionAttributionRead(loading, {
      type: "loaded",
      request: first,
      result: "a",
    }),
  ]) {
    expect(hasAttributionReadSettled(settled, first)).toBe(true);
    // The render before a refresh is requested, and the refresh loading.
    const refresh = request(scopeA);
    expect(hasAttributionReadSettled(settled, refresh)).toBe(true);
    expect(
      hasAttributionReadSettled(
        transitionAttributionRead(settled, {
          type: "request",
          request: refresh,
        }),
        refresh,
      ),
    ).toBe(true);
    // Never for another document or session.
    expect(hasAttributionReadSettled(settled, request(scopeB))).toBe(false);
  }
});
