import { expect, test } from "bun:test";
import { transitionRowWriters } from "./rowWritersMachine";

test("replacement requests discard old identities and cannot finish out of order", () => {
  const first = { documentId: "doc-1" };
  const next = { documentId: "doc-2" };
  const loading = transitionRowWriters(
    { status: "idle" },
    { type: "request", request: first },
  );
  expect(loading).toEqual({ status: "loading", request: first });
  const ready = transitionRowWriters(loading, {
    type: "loaded",
    request: first,
    segments: [],
  });
  expect(ready).toEqual({ status: "ready", request: first, segments: [] });
  const replacement = transitionRowWriters(ready, {
    type: "request",
    request: next,
  });
  expect(replacement).toEqual({ status: "loading", request: next });
  expect(
    transitionRowWriters(replacement, {
      type: "loaded",
      request: first,
      segments: [],
    }),
  ).toBe(replacement);
  expect(
    transitionRowWriters(replacement, { type: "failed", request: first }),
  ).toBe(replacement);
  expect(
    transitionRowWriters(replacement, { type: "failed", request: next }),
  ).toEqual({ status: "unavailable", request: next });
  const idle = transitionRowWriters(replacement, {
    type: "request",
    request: null,
  });
  expect(idle).toEqual({ status: "idle" });
  expect(
    transitionRowWriters(idle, { type: "loaded", request: next, segments: [] }),
  ).toBe(idle);
});

test("reset and restart for the same document require a new request identity", () => {
  const oldRequest = { documentId: "doc" };
  const newRequest = { documentId: "doc" };
  const reset = transitionRowWriters(
    { status: "loading", request: oldRequest },
    { type: "request", request: null },
  );
  const current = transitionRowWriters(reset, {
    type: "request",
    request: newRequest,
  });
  Object.freeze(current);
  expect(
    transitionRowWriters(current, {
      type: "loaded",
      request: oldRequest,
      segments: [],
    }),
  ).toBe(current);
  expect(
    transitionRowWriters(current, { type: "failed", request: oldRequest }),
  ).toBe(current);
  expect(
    transitionRowWriters(current, {
      type: "loaded",
      request: newRequest,
      segments: [],
    }),
  ).toEqual({ status: "ready", request: newRequest, segments: [] });
});

test("settled requests ignore duplicate completions and can restart or reset", () => {
  const request = { documentId: "doc" };
  const states: Array<Parameters<typeof transitionRowWriters>[0]> = [
    { status: "idle" },
    { status: "ready", request, segments: [] },
    { status: "unavailable", request },
  ];
  for (const state of states) {
    Object.freeze(state);
    expect(
      transitionRowWriters(state, { type: "loaded", request, segments: [] }),
    ).toBe(state);
    expect(transitionRowWriters(state, { type: "failed", request })).toBe(
      state,
    );
    expect(transitionRowWriters(state, { type: "request", request })).toEqual({
      status: "loading",
      request,
    });
    expect(
      transitionRowWriters(state, { type: "request", request: null }),
    ).toEqual({ status: "idle" });
  }
});
