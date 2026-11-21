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
  expect(SAVED).toEqual({ copy: COPY, index: 3, status: "saved" });
});

test("a copy that was not created is reported as refused", () => {
  expect(REFUSED).toEqual({ index: 3, status: "refused" });
});

test("cancelling or showing another stop abandons a confirmation", () => {
  expect(run(CONFIRMING, { type: "cancelled" })).toBe(
    IDLE_DOCUMENT_HISTORY_COPY,
  );
  expect(run(CONFIRMING, { index: 4, type: "stop-shown" })).toBe(
    IDLE_DOCUMENT_HISTORY_COPY,
  );
});

test("an outcome belongs to the stop it was raised on", () => {
  for (const outcome of [SAVED, REFUSED]) {
    expect(run(outcome, { index: 4, type: "stop-shown" })).toBe(
      IDLE_DOCUMENT_HISTORY_COPY,
    );
    expect(run(outcome, { index: 5, type: "requested" })).toEqual({
      index: 5,
      status: "confirming",
    });
  }
});

test("showing the state's own stop again changes nothing", () => {
  // The timeline remounts on the same stop, as after a reload that lands
  // where it left.
  for (const state of [CONFIRMING, SAVING, SAVED, REFUSED]) {
    expect(run(state, { index: 3, type: "stop-shown" })).toBe(state);
  }
  expect(
    run(IDLE_DOCUMENT_HISTORY_COPY, { index: 3, type: "stop-shown" }),
  ).toBe(IDLE_DOCUMENT_HISTORY_COPY);
});

test("a copy in flight follows the stop on screen and reports there", () => {
  const moved = run(SAVING, { index: 7, type: "stop-shown" });
  expect(moved).toEqual({ index: 7, run: 1, status: "saving" });

  const saved = run(moved, { copy: COPY, run: 1, type: "finished" });
  expect(saved).toEqual({ copy: COPY, index: 7, status: "saved" });
  // It stays while that stop is shown, and goes with the next one.
  expect(run(saved, { index: 7, type: "stop-shown" })).toBe(saved);
  expect(run(saved, { index: 8, type: "stop-shown" })).toBe(
    IDLE_DOCUMENT_HISTORY_COPY,
  );
  expect(run(moved, { copy: null, run: 1, type: "finished" })).toEqual({
    index: 7,
    status: "refused",
  });
});

test("an outcome that arrives while no stop is shown is reported on the next", () => {
  // History reloads while the copy is being created: the timeline is gone.
  const hidden = run(SAVING, { index: null, type: "stop-shown" });
  expect(hidden).toEqual({ index: null, run: 1, status: "saving" });

  for (const copy of [COPY, null]) {
    const outcome = run(hidden, { copy, run: 1, type: "finished" });
    expect(outcome.status).toBe(copy === null ? "refused" : "saved");
    // The timeline comes back on another stop than the one copied.
    const shown = run(outcome, { index: 9, type: "stop-shown" });
    expect(shown).toMatchObject({ index: 9, status: outcome.status });
    expect(run(shown, { index: 10, type: "stop-shown" })).toBe(
      IDLE_DOCUMENT_HISTORY_COPY,
    );
  }
});

test("the timeline going away drops nothing that a stop has shown", () => {
  for (const state of [
    IDLE_DOCUMENT_HISTORY_COPY,
    CONFIRMING,
    SAVED,
    REFUSED,
  ]) {
    expect(run(state, { index: null, type: "stop-shown" })).toBe(state);
  }
  // A copy that comes back on the stop it left picks up where it was.
  expect(
    run(
      SAVING,
      { index: null, type: "stop-shown" },
      { index: 3, type: "stop-shown" },
    ),
  ).toEqual(SAVING);
});

test("a confirmation whose copy is withdrawn is refused, not left open", () => {
  expect(run(CONFIRMING, { type: "withdrawn" })).toEqual({
    index: 3,
    status: "refused",
  });
  // Nothing else is waiting on the offer.
  for (const state of [IDLE_DOCUMENT_HISTORY_COPY, SAVED, REFUSED]) {
    expect(run(state, { type: "withdrawn" })).toBe(state);
  }
});

test("a copy in flight cannot be cancelled, replaced, or withdrawn", () => {
  for (const event of [
    { type: "cancelled" },
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
