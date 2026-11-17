import { expect, test } from "bun:test";
import type { DocumentSummary } from "@tearleads/client-sdk";
import {
  type DocumentSummaryLoadEvent,
  type DocumentSummaryLoadState,
  initialDocumentSummaryLoad,
  transitionDocumentSummaryLoad,
} from "./documentSummaryLoadMachine";

const SUMMARY = { id: "local-1", title: "Note" } as DocumentSummary;
const OTHER = { id: "local-1", title: "Renamed" } as DocumentSummary;

function run(
  state: DocumentSummaryLoadState,
  ...events: DocumentSummaryLoadEvent[]
): DocumentSummaryLoadState {
  return events.reduce(transitionDocumentSummaryLoad, state);
}

const LOADING = run(initialDocumentSummaryLoad(null), {
  request: 1,
  type: "load-started",
});

test("a summary the caller already holds is loaded from the start", () => {
  expect(initialDocumentSummaryLoad(SUMMARY)).toEqual({
    documentSummary: SUMMARY,
    status: "loaded",
  });
  expect(initialDocumentSummaryLoad(null).status).toBe("loading");
});

test("a load finishes with the summary, with none, or with a failure", () => {
  expect(
    run(LOADING, {
      documentSummary: SUMMARY,
      request: 1,
      type: "load-finished",
    }),
  ).toEqual({ documentSummary: SUMMARY, status: "loaded" });
  expect(
    run(LOADING, { documentSummary: null, request: 1, type: "load-finished" }),
  ).toEqual({ request: 1, status: "missing" });
  expect(
    run(LOADING, { message: "closed", request: 1, type: "load-failed" }),
  ).toEqual({ message: "closed", request: 1, status: "failed" });
});

test("only the newest load may answer", () => {
  const reloading = run(LOADING, { request: 2, type: "load-started" });

  expect(
    run(reloading, {
      documentSummary: SUMMARY,
      request: 1,
      type: "load-finished",
    }),
  ).toBe(reloading);
  expect(
    run(reloading, { message: "stale", request: 1, type: "load-failed" }),
  ).toBe(reloading);
});

test("retrying a missing summary stays missing until the retry answers", () => {
  const missing = run(LOADING, {
    documentSummary: null,
    request: 1,
    type: "load-finished",
  });
  const retrying = run(missing, { request: 2, type: "load-started" });

  // No flash of a loading state while a document hydrates.
  expect(retrying).toEqual({ request: 2, status: "missing" });
  expect(
    run(retrying, { documentSummary: null, request: 2, type: "load-finished" }),
  ).toEqual({ request: 2, status: "missing" });
  expect(
    run(retrying, {
      documentSummary: SUMMARY,
      request: 2,
      type: "load-finished",
    }),
  ).toEqual({ documentSummary: SUMMARY, status: "loaded" });
});

test("a summary that becomes known replaces whatever was there", () => {
  const failed = run(LOADING, {
    message: "closed",
    request: 1,
    type: "load-failed",
  });
  const loaded = run(failed, { documentSummary: SUMMARY, type: "known" });

  expect(loaded).toEqual({ documentSummary: SUMMARY, status: "loaded" });
  // The same summary again is not a change; a newer one is.
  expect(run(loaded, { documentSummary: SUMMARY, type: "known" })).toBe(loaded);
  expect(run(loaded, { documentSummary: OTHER, type: "known" })).toEqual({
    documentSummary: OTHER,
    status: "loaded",
  });
});

test("a loaded or failed summary ignores a load that is not its own", () => {
  const loaded = initialDocumentSummaryLoad(SUMMARY);
  const failed = run(LOADING, {
    message: "closed",
    request: 1,
    type: "load-failed",
  });

  for (const state of [loaded, failed]) {
    expect(
      run(state, { documentSummary: OTHER, request: 1, type: "load-finished" }),
    ).toBe(state);
    expect(run(state, { request: 5, type: "load-started" })).toEqual({
      request: 5,
      status: "loading",
    });
  }
});
