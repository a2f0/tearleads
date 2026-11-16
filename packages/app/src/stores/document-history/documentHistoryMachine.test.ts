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

test("the stop on screen is accepted only for the selected stop and run", () => {
  const state = ready(3);

  expect(run(state, { run: 1, stop: shown(2), type: "shown" })).toMatchObject({
    shown: shown(2),
  });
  // A replay that finished after the user moved on.
  expect(run(state, { run: 1, stop: shown(0), type: "shown" })).toBe(state);
  expect(run(state, { run: 7, stop: shown(2), type: "shown" })).toBe(state);
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
    { run: 1, stop: shown(0), type: "shown" },
    { type: "tick" },
  );
  expect(advanced).toMatchObject({ playing: true, selectedIndex: 1 });
});

test("playback stops on the newest stop", () => {
  const finished = ready(
    3,
    { type: "play-toggled" },
    { run: 1, stop: shown(0), type: "shown" },
    { type: "tick" },
    { run: 1, stop: shown(1), type: "shown" },
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

test("a failed replay fails the history for the current run only", () => {
  const state = ready(3);

  expect(
    run(state, { message: "closed", run: 1, type: "replay-failed" }),
  ).toEqual({ message: "closed", run: 1, status: "failed" });
  expect(run(state, { message: "stale", run: 4, type: "replay-failed" })).toBe(
    state,
  );
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
    { run: 1, stop: shown(0), type: "shown" },
    { history: history(2), run: 1, type: "opened" },
  ];

  for (const state of [unavailable, failed, INITIAL_DOCUMENT_HISTORY]) {
    for (const event of events) {
      if (state.status === "loading" && event.type === "opened") continue;
      expect(transitionDocumentHistory(state, event)).toBe(state);
    }
  }
});
