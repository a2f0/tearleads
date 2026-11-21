import { expect, test } from "bun:test";
import type { DocumentSummary } from "@tearleads/client-sdk";
import {
  type DocumentHistoryCopyEvent,
  type DocumentHistoryCopyState,
  IDLE_DOCUMENT_HISTORY_COPY,
  transitionDocumentHistoryCopy,
} from "./documentHistoryCopyMachine";

function run(
  state: DocumentHistoryCopyState,
  ...events: DocumentHistoryCopyEvent[]
): DocumentHistoryCopyState {
  return events.reduce(transitionDocumentHistoryCopy, state);
}

const COPY: DocumentSummary = {
  containerId: "folder-1",
  documentId: null,
  documentKind: "note",
  id: "copy-1",
  title: "an earlier version",
  updatedAt: "2030-01-01T12:00:00.000Z",
};

const CONFIRMING = run(IDLE_DOCUMENT_HISTORY_COPY, {
  index: 3,
  type: "requested",
});
const SAVING = run(CONFIRMING, { run: 1, type: "confirmed" });
const SAVED = run(SAVING, { copy: COPY, run: 1, type: "finished" });
const REFUSED = run(SAVING, { copy: null, run: 1, type: "finished" });

test("a copy is asked, confirmed, and saved", () => {
  expect(CONFIRMING).toEqual({ index: 3, status: "confirming" });
  expect(SAVING).toEqual({ index: 3, run: 1, status: "saving" });
  expect(SAVED).toEqual({ copy: COPY, status: "saved" });
});

test("a copy that was not created is reported as refused", () => {
  expect(REFUSED).toEqual({ status: "refused" });
});

test("cancelling or moving to another stop abandons a confirmation", () => {
  expect(run(CONFIRMING, { type: "cancelled" })).toBe(
    IDLE_DOCUMENT_HISTORY_COPY,
  );
  expect(run(CONFIRMING, { type: "stop-changed" })).toBe(
    IDLE_DOCUMENT_HISTORY_COPY,
  );
});

test("an outcome belongs to the stop it was raised on", () => {
  for (const outcome of [SAVED, REFUSED]) {
    expect(run(outcome, { type: "stop-changed" })).toBe(
      IDLE_DOCUMENT_HISTORY_COPY,
    );
    expect(run(outcome, { index: 5, type: "requested" })).toEqual({
      index: 5,
      status: "confirming",
    });
  }
});

test("a confirmation whose copy is withdrawn is refused, not left open", () => {
  expect(run(CONFIRMING, { type: "withdrawn" })).toEqual({ status: "refused" });
  // Nothing else is waiting on the offer.
  for (const state of [IDLE_DOCUMENT_HISTORY_COPY, SAVED, REFUSED]) {
    expect(run(state, { type: "withdrawn" })).toBe(state);
  }
});

test("a copy in flight cannot be cancelled, replaced, or moved away from", () => {
  for (const event of [
    { type: "cancelled" },
    { type: "stop-changed" },
    { type: "withdrawn" },
    { index: 9, type: "requested" },
    { run: 2, type: "confirmed" },
  ] satisfies DocumentHistoryCopyEvent[]) {
    expect(run(SAVING, event)).toBe(SAVING);
  }
});

test("only the current run finishes a copy", () => {
  expect(run(SAVING, { copy: COPY, run: 7, type: "finished" })).toBe(SAVING);
  expect(run(SAVING, { copy: null, run: 7, type: "finished" })).toBe(SAVING);
});

test("events that do not apply return the same state", () => {
  expect(run(IDLE_DOCUMENT_HISTORY_COPY, { type: "cancelled" })).toBe(
    IDLE_DOCUMENT_HISTORY_COPY,
  );
  expect(run(IDLE_DOCUMENT_HISTORY_COPY, { run: 1, type: "confirmed" })).toBe(
    IDLE_DOCUMENT_HISTORY_COPY,
  );
  for (const state of [IDLE_DOCUMENT_HISTORY_COPY, CONFIRMING, SAVED]) {
    expect(run(state, { copy: COPY, run: 1, type: "finished" })).toBe(state);
  }
  expect(run(SAVED, { run: 2, type: "confirmed" })).toBe(SAVED);
});
