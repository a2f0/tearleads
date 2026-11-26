import { expect, test } from "bun:test";
import type {
  DocumentHistory,
  DocumentHistoryChange,
  DocumentHistoryView,
} from "@tearleads/client-sdk";
import {
  type DocumentHistoryEvent,
  type DocumentHistoryState,
  INITIAL_DOCUMENT_HISTORY,
  isCurrentDocumentVersion,
  localDocumentHistory,
  type ShownDocumentHistoryStop,
  transitionDocumentHistory,
} from "./documentHistoryMachine";

const EMPTY_CHANGE: DocumentHistoryChange = {
  attachments: { added: [], removed: [], replaced: [] },
  fields: [],
  kindChanged: false,
  rows: { added: [], changed: [], removed: [] },
  text: null,
};

function view(text: string): DocumentHistoryView {
  return {
    attachments: [],
    documentKind: "note",
    fieldValidationIssues: [],
    rows: [],
    structuredFields: {},
    text,
    title: text,
  };
}

function shown(index: number): ShownDocumentHistoryStop {
  return { change: EMPTY_CHANGE, index, view: view(`stop ${index}`) };
}

function history(stopCount: number): DocumentHistory {
  return {
    changeAt: () => EMPTY_CHANGE,
    close: () => undefined,
    stops: Array.from({ length: stopCount }, (_, index) => ({
      committedAt: index * 1000,
      endCounter: index + 1,
      index,
      peerId: "1",
      startCounter: index,
    })),
    versionAt: () => [],
    viewAt: (index) => view(`stop ${index}`),
  };
}

function run(
  state: DocumentHistoryState,
  ...events: DocumentHistoryEvent[]
): DocumentHistoryState {
  return events.reduce(transitionDocumentHistory, state);
}

function ready(stopCount: number, ...events: DocumentHistoryEvent[]) {
  const state = run(
    INITIAL_DOCUMENT_HISTORY,
    { run: 1, type: "open-started" },
    { history: history(stopCount), run: 1, type: "opened" },
    ...events,
  );
  if (state.status !== "ready") throw new Error("expected ready history");
  return state;
}

test("an opened history starts on its newest stop", () => {
  const state = ready(5);

  expect(state.selectedIndex).toBe(4);
  expect(state.shown).toBeNull();
  expect(state.playing).toBe(false);
  expect(state.newerAvailable).toBe(false);
  // It is this device's copy.
  expect(state.source).toBe("local");
  expect(localDocumentHistory(state)).toBe(state.history);
});

test("a document with no history is unavailable", () => {
  const opening = run(INITIAL_DOCUMENT_HISTORY, {
    run: 1,
    type: "open-started",
  });

  expect(run(opening, { history: null, run: 1, type: "opened" })).toEqual({
    run: 1,
    status: "unavailable",
  });
  expect(run(opening, { history: history(0), run: 1, type: "opened" })).toEqual(
    { run: 1, status: "unavailable" },
  );
});

test("only the current run finishes an open", () => {
  const opening = run(INITIAL_DOCUMENT_HISTORY, {
    run: 2,
    type: "open-started",
  });

  expect(run(opening, { history: history(3), run: 1, type: "opened" })).toBe(
    opening,
  );
  expect(run(opening, { message: "stale", run: 1, type: "open-failed" })).toBe(
    opening,
  );
  expect(
    run(opening, { message: "boom", run: 2, type: "open-failed" }),
  ).toEqual({ message: "boom", run: 2, status: "failed" });
});

test("reopening from any state returns to loading under the new run", () => {
  expect(run(ready(3), { run: 9, type: "open-started" })).toEqual({
    run: 9,
    status: "loading",
  });
});

test("seeking clamps to the timeline and ignores a stop already selected", () => {
  const state = ready(5);

  expect(run(state, { index: 2, type: "seeked" })).toMatchObject({
    selectedIndex: 2,
  });
  expect(run(state, { index: -3, type: "seeked" })).toMatchObject({
    selectedIndex: 0,
  });
  expect(run(state, { index: 99, type: "seeked" })).toBe(state);
  expect(run(state, { index: Number.NaN, type: "seeked" })).toBe(state);
  expect(run(state, { index: 1.6, type: "seeked" })).toMatchObject({
    selectedIndex: 2,
  });
});

test("stepping moves one stop and stops at either end", () => {
  const state = ready(3);

  expect(run(state, { delta: -1, type: "stepped" })).toMatchObject({
    selectedIndex: 1,
  });
  expect(run(state, { delta: 1, type: "stepped" })).toBe(state);
  expect(
    run(state, { index: 0, type: "seeked" }, { delta: -1, type: "stepped" }),
  ).toMatchObject({ selectedIndex: 0 });
});

test("the stop on screen is accepted only for the selected stop of the history shown", () => {
  const state = ready(3);
  const { history: open } = state;

  expect(
    run(state, { history: open, stop: shown(2), type: "shown" }),
  ).toMatchObject({ shown: shown(2) });
  // A replay that finished after the user moved on.
  expect(run(state, { history: open, stop: shown(0), type: "shown" })).toBe(
    state,
  );
  // A replay of a capture that has since been closed and reopened.
  expect(
    run(state, { history: history(3), stop: shown(2), type: "shown" }),
  ).toBe(state);
});

test("playing from the newest stop starts over from the oldest", () => {
  const playing = ready(3, { type: "play-toggled" });

  expect(playing).toMatchObject({ playing: true, selectedIndex: 0 });
  expect(run(playing, { type: "play-toggled" })).toMatchObject({
    playing: false,
    selectedIndex: 0,
  });
});

test("playing from the middle continues from there", () => {
  expect(
    ready(4, { index: 1, type: "seeked" }, { type: "play-toggled" }),
  ).toMatchObject({ playing: true, selectedIndex: 1 });
});

test("a single-stop history cannot play", () => {
  const state = ready(1);

  expect(run(state, { type: "play-toggled" })).toBe(state);
});

test("playback advances only after the selected stop is on screen", () => {
  const playing = ready(3, { type: "play-toggled" });

  // Stop 0 has not been replayed yet: the tick waits.
  expect(run(playing, { type: "tick" })).toBe(playing);

  const advanced = run(
    playing,
    { history: playing.history, stop: shown(0), type: "shown" },
    { type: "tick" },
  );
  expect(advanced).toMatchObject({ playing: true, selectedIndex: 1 });
});

test("playback stops on the newest stop", () => {
  const playing = ready(3, { type: "play-toggled" });
  const finished = run(
    playing,
    { history: playing.history, stop: shown(0), type: "shown" },
    { type: "tick" },
    { history: playing.history, stop: shown(1), type: "shown" },
    { type: "tick" },
  );

  expect(finished).toMatchObject({ playing: false, selectedIndex: 2 });
  expect(run(finished, { type: "tick" })).toBe(finished);
});

test("choosing a stop stops playback", () => {
  const playing = ready(
    4,
    { index: 1, type: "seeked" },
    { type: "play-toggled" },
  );

  expect(run(playing, { index: 3, type: "seeked" })).toMatchObject({
    playing: false,
    selectedIndex: 3,
  });
  expect(run(playing, { index: 1, type: "seeked" })).toMatchObject({
    playing: false,
    selectedIndex: 1,
  });
});

test("a tick outside playback changes nothing", () => {
  const state = ready(3);

  expect(run(state, { type: "tick" })).toBe(state);
});

test("newer edits are flagged once, for the current run", () => {
  const state = ready(3);
  const flagged = run(state, { run: 1, type: "newer-found" });

  expect(flagged).toMatchObject({ newerAvailable: true });
  expect(run(flagged, { run: 1, type: "newer-found" })).toBe(flagged);
  expect(run(state, { run: 2, type: "newer-found" })).toBe(state);
});

test("only the newest stop of an up-to-date capture is the current version", () => {
  const state = ready(3);

  expect(isCurrentDocumentVersion(state, 2)).toBe(true);
  expect(isCurrentDocumentVersion(state, 1)).toBe(false);
  // Newer edits exist: the capture's last stop is now a past version, and
  // it can be restored like any other.
  const overtaken = run(state, { run: 1, type: "newer-found" });
  if (overtaken.status !== "ready") throw new Error("expected ready history");
  expect(isCurrentDocumentVersion(overtaken, 2)).toBe(false);
});

test("a failed replay fails the history only if it is the one shown", () => {
  const state = ready(3);

  expect(
    run(state, {
      history: state.history,
      message: "closed",
      type: "replay-failed",
    }),
  ).toEqual({ message: "closed", run: 1, status: "failed" });
  expect(
    run(state, {
      history: history(3),
      message: "stale",
      type: "replay-failed",
    }),
  ).toBe(state);
});

test("states without an open history ignore transport events", () => {
  const unavailable: DocumentHistoryState = { run: 1, status: "unavailable" };
  const failed: DocumentHistoryState = {
    message: "boom",
    run: 1,
    status: "failed",
  };
  const events: DocumentHistoryEvent[] = [
    { index: 0, type: "seeked" },
    { delta: 1, type: "stepped" },
    { type: "play-toggled" },
    { type: "tick" },
    { history: history(2), stop: shown(0), type: "shown" },
    { history: history(2), run: 1, type: "opened" },
    { signed: history(2), type: "signed-shown" },
    { type: "local-shown" },
  ];

  for (const state of [unavailable, failed, INITIAL_DOCUMENT_HISTORY]) {
    for (const event of events) {
      if (state.status === "loading" && event.type === "opened") continue;
      expect(transitionDocumentHistory(state, event)).toBe(state);
    }
  }
});

/** A device's history playing from stop 1 of 3, and the signed replay. */
function mismatched() {
  const local = ready(
    3,
    { index: 1, type: "seeked" },
    { type: "play-toggled" },
  );
  const signed = history(5);
  const showing = run(local, { signed, type: "signed-shown" });
  if (showing.status !== "ready") throw new Error("expected ready history");
  return { local, showing, signed };
}

test("the signed replay takes the screen on its newest stop", () => {
  const { local, showing, signed } = mismatched();

  expect(showing).toMatchObject({
    playing: false,
    run: local.run,
    selectedIndex: 4,
    shown: null,
    source: "signed",
  });
  expect(showing.history).toBe(signed);
  // This device's capture is kept, not closed, for the way back.
  expect(localDocumentHistory(showing)).toBe(local.history);
  // Its transport works as it does on any history.
  expect(run(showing, { delta: -1, type: "stepped" })).toMatchObject({
    selectedIndex: 3,
    source: "signed",
  });
});

test("this device's copy comes back on its newest stop", () => {
  const { local, showing } = mismatched();
  const back = run(showing, { type: "local-shown" });

  expect(back).toMatchObject({
    playing: false,
    selectedIndex: 2,
    shown: null,
    source: "local",
  });
  expect(back.status === "ready" && back.history).toBe(local.history);
  expect(localDocumentHistory(back)).toBe(local.history);
});

test("newer edits found under the signed replay are still flagged on the way back", () => {
  const { showing } = mismatched();
  const flagged = run(showing, { run: 1, type: "newer-found" });

  expect(flagged).toMatchObject({ newerAvailable: true, source: "signed" });
  expect(run(flagged, { type: "local-shown" })).toMatchObject({
    newerAvailable: true,
    source: "local",
  });
});

test("a stop replayed from one history is never shown on the other", () => {
  const { local, showing, signed } = mismatched();
  // A replay of this device's stop 2 finishes after the signed replay took
  // the screen, with stop 2 selected there too.
  const onSigned = run(showing, { index: 2, type: "seeked" });
  expect(
    run(onSigned, { history: local.history, stop: shown(2), type: "shown" }),
  ).toBe(onSigned);
  expect(
    run(onSigned, {
      history: local.history,
      message: "closed",
      type: "replay-failed",
    }),
  ).toBe(onSigned);
  // And the other way round, once the device's copy is back on stop 2.
  const back = run(showing, { type: "local-shown" });
  expect(run(back, { history: signed, stop: shown(2), type: "shown" })).toBe(
    back,
  );
  expect(
    run(back, { history: signed, message: "closed", type: "replay-failed" }),
  ).toBe(back);
});

test("a signed replay with nothing to show leaves the device's copy on screen", () => {
  const state = ready(3);

  expect(run(state, { signed: history(0), type: "signed-shown" })).toBe(state);
});

test("a source already on screen is not shown again", () => {
  const { showing } = mismatched();
  const local = ready(3);

  expect(run(showing, { signed: history(2), type: "signed-shown" })).toBe(
    showing,
  );
  expect(run(local, { type: "local-shown" })).toBe(local);
});

test("no stop of a signed replay is the document as it is now", () => {
  const { showing } = mismatched();

  // The device's copy differs from it, so even its newest stop can be
  // restored.
  expect(isCurrentDocumentVersion(showing, 4)).toBe(false);
});

test("reopening while the signed replay is shown drops both histories", () => {
  const { showing } = mismatched();
  const reopening = run(showing, { run: 2, type: "open-started" });

  expect(reopening).toEqual({ run: 2, status: "loading" });
  expect(localDocumentHistory(reopening)).toBeNull();
});
