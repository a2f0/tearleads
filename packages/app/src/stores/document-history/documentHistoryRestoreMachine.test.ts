import { expect, test } from "bun:test";
import {
  type DocumentHistoryRestoreEvent,
  type DocumentHistoryRestoreState,
  IDLE_DOCUMENT_HISTORY_RESTORE,
  transitionDocumentHistoryRestore,
} from "./documentHistoryRestoreMachine";

function run(
  state: DocumentHistoryRestoreState,
  ...events: DocumentHistoryRestoreEvent[]
): DocumentHistoryRestoreState {
  return events.reduce(transitionDocumentHistoryRestore, state);
}

const CONFIRMING = run(IDLE_DOCUMENT_HISTORY_RESTORE, {
  index: 3,
  type: "requested",
});
const RESTORING = run(CONFIRMING, { run: 1, type: "confirmed" });

test("a restore is asked, confirmed, and finished", () => {
  expect(CONFIRMING).toEqual({ index: 3, status: "confirming" });
  expect(RESTORING).toEqual({ index: 3, run: 1, status: "restoring" });
  expect(run(RESTORING, { restored: true, run: 1, type: "finished" })).toBe(
    IDLE_DOCUMENT_HISTORY_RESTORE,
  );
});

test("a restore that did not persist is reported as refused", () => {
  expect(run(RESTORING, { restored: false, run: 1, type: "finished" })).toEqual(
    { status: "refused" },
  );
});

test("cancelling or moving to another stop abandons a confirmation", () => {
  expect(run(CONFIRMING, { type: "cancelled" })).toBe(
    IDLE_DOCUMENT_HISTORY_RESTORE,
  );
  expect(run(CONFIRMING, { type: "stop-changed" })).toBe(
    IDLE_DOCUMENT_HISTORY_RESTORE,
  );
});

test("a restore in flight cannot be cancelled, replaced, or finished by another run", () => {
  for (const event of [
    { type: "cancelled" },
    { type: "stop-changed" },
    { index: 9, type: "requested" },
    { run: 2, type: "confirmed" },
    { restored: true, run: 2, type: "finished" },
  ] satisfies DocumentHistoryRestoreEvent[]) {
    expect(transitionDocumentHistoryRestore(RESTORING, event)).toBe(RESTORING);
  }
});

test("a refusal clears when the user moves on or asks again", () => {
  const refused = run(RESTORING, { restored: false, run: 1, type: "finished" });

  expect(run(refused, { type: "stop-changed" })).toBe(
    IDLE_DOCUMENT_HISTORY_RESTORE,
  );
  expect(run(refused, { index: 1, type: "requested" })).toEqual({
    index: 1,
    status: "confirming",
  });
  expect(run(refused, { run: 5, type: "confirmed" })).toBe(refused);
});

test("an idle restore ignores everything but a request", () => {
  for (const event of [
    { type: "cancelled" },
    { type: "stop-changed" },
    { run: 1, type: "confirmed" },
    { restored: true, run: 1, type: "finished" },
  ] satisfies DocumentHistoryRestoreEvent[]) {
    expect(
      transitionDocumentHistoryRestore(IDLE_DOCUMENT_HISTORY_RESTORE, event),
    ).toBe(IDLE_DOCUMENT_HISTORY_RESTORE);
  }
});
