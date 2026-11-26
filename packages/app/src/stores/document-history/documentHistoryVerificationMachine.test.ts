import { expect, test } from "bun:test";
import type {
  DocumentHistory,
  DocumentHistoryVerification,
  DocumentHistoryVerificationReport,
} from "@tearleads/client-sdk";
import {
  type DocumentHistoryVerificationEffect,
  type DocumentHistoryVerificationEvent,
  type DocumentHistoryVerificationState,
  IDLE_DOCUMENT_HISTORY_VERIFICATION,
  transitionDocumentHistoryVerification,
} from "./documentHistoryVerificationMachine";

type State = DocumentHistoryVerificationState;
type Event = DocumentHistoryVerificationEvent;
type Effect = DocumentHistoryVerificationEffect;

function replay(): DocumentHistory {
  return {
    changeAt: () => {
      throw new Error("not replayed here");
    },
    close: () => undefined,
    stops: [],
    versionAt: () => [],
    viewAt: () => {
      throw new Error("not replayed here");
    },
  };
}

/** The capture's newest version, and the same version in another order. */
const CAPTURE = [
  { counter: 4, peerId: "1" },
  { counter: 9, peerId: "2" },
];
const CAPTURE_REORDERED = [CAPTURE[1], CAPTURE[0]].flatMap((entry) =>
  entry === undefined ? [] : [entry],
);
const REPORT: DocumentHistoryVerificationReport = {
  localVersion: CAPTURE_REORDERED,
  ranges: [],
  serverAhead: false,
  voidUpdateCount: 0,
};
/** A report on a history that gained an edit after the capture was taken. */
const LATER_REPORT: DocumentHistoryVerificationReport = {
  ...REPORT,
  localVersion: [
    { counter: 5, peerId: "1" },
    { counter: 9, peerId: "2" },
  ],
};
const SIGNED = replay();
const OTHER_SIGNED = replay();
const PROGRESS = { updatesRead: 64, updatesTotal: 130 };

const IDLE = IDLE_DOCUMENT_HISTORY_VERIFICATION;
const CHECKING: State = {
  captureVersion: CAPTURE,
  progress: null,
  run: 1,
  status: "checking",
};
const VERIFIED: State = { report: REPORT, run: 1, status: "verified" };
const MISMATCH: State = {
  report: REPORT,
  run: 1,
  signed: SIGNED,
  status: "mismatch",
};
const UNAVAILABLE: State = { reason: "offline", run: 1, status: "unavailable" };
const FAILED: State = { message: "boom", run: 1, status: "failed" };
const SETTLED_STATES = [VERIFIED, MISMATCH, UNAVAILABLE, FAILED];

const REQUESTED: Event = { captureVersion: CAPTURE, run: 2, type: "requested" };
const CHECKING_AGAIN: State = { ...CHECKING, run: 2 };
const CLOSE_SIGNED: Effect = { signed: SIGNED, type: "close-signed" };

function settled(
  result: DocumentHistoryVerification | null,
  run = 1,
): Extract<Event, { type: "settled" }> {
  return { result, run, type: "settled" };
}

const VERIFIED_RESULT: DocumentHistoryVerification = {
  ...REPORT,
  status: "verified",
};
const MISMATCH_RESULT: DocumentHistoryVerification = {
  ...REPORT,
  signed: SIGNED,
  status: "mismatch",
};

/** `[name, state, event, next state, effects]`; "same" is the same reference. */
const TABLE: ReadonlyArray<
  readonly [string, State, Event, State | "same", ReadonlyArray<Effect>]
> = [
  // requested: a check starts from every state, under the new run.
  ["idle + requested", IDLE, REQUESTED, CHECKING_AGAIN, []],
  [
    "checking + requested replaces the check and stops the old one",
    { ...CHECKING, progress: PROGRESS },
    REQUESTED,
    CHECKING_AGAIN,
    [{ run: 1, type: "abort" }],
  ],
  ["verified + requested", VERIFIED, REQUESTED, CHECKING_AGAIN, []],
  [
    "mismatch + requested closes the signed replay",
    MISMATCH,
    REQUESTED,
    CHECKING_AGAIN,
    [CLOSE_SIGNED],
  ],
  ["unavailable + requested", UNAVAILABLE, REQUESTED, CHECKING_AGAIN, []],
  ["failed + requested", FAILED, REQUESTED, CHECKING_AGAIN, []],

  // progressed: only the running check reports how far it has read.
  [
    "checking + progressed",
    CHECKING,
    { progress: PROGRESS, run: 1, type: "progressed" },
    { ...CHECKING, progress: PROGRESS },
    [],
  ],
  [
    "checking + progressed from another run",
    CHECKING,
    { progress: PROGRESS, run: 7, type: "progressed" },
    "same",
    [],
  ],

  // settled: each result of the running check has its state.
  [
    "checking + settled verified, the version given in another order",
    CHECKING,
    settled(VERIFIED_RESULT),
    VERIFIED,
    [],
  ],
  [
    "checking + settled mismatch keeps the signed replay",
    CHECKING,
    settled(MISMATCH_RESULT),
    MISMATCH,
    [],
  ],
  [
    "checking + settled unavailable",
    CHECKING,
    settled({ reason: "rejected", status: "unavailable" }),
    { reason: "rejected", run: 1, status: "unavailable" },
    [],
  ],
  [
    "checking + settled with an unreachable key keeps its epoch",
    CHECKING,
    settled({
      contentKeyEpoch: 3,
      error: new Error("unreachable"),
      reason: "epoch_key_unreachable",
      status: "unavailable",
    } as DocumentHistoryVerification),
    {
      contentKeyEpoch: 3,
      reason: "epoch_key_unreachable",
      run: 1,
      status: "unavailable",
    },
    [],
  ],
  [
    "checking + settled with no result (the database was not ready)",
    CHECKING,
    settled(null),
    { reason: "interrupted", run: 1, status: "unavailable" },
    [],
  ],
  [
    "checking + settled verified on a history newer than the capture",
    CHECKING,
    settled({ ...LATER_REPORT, status: "verified" }),
    { reason: "capture_outdated", run: 1, status: "unavailable" },
    [],
  ],
  [
    "checking + settled mismatch on a history newer than the capture",
    CHECKING,
    settled({ ...LATER_REPORT, signed: SIGNED, status: "mismatch" }),
    { reason: "capture_outdated", run: 1, status: "unavailable" },
    [CLOSE_SIGNED],
  ],

  // settled, from a run that is not the running check: nothing changes, and
  // a signed replay it brought is closed, since no state will hold it.
  [
    "checking + settled from another run",
    CHECKING,
    settled(VERIFIED_RESULT, 7),
    "same",
    [],
  ],
  [
    "checking + settled mismatch from another run",
    CHECKING,
    settled(MISMATCH_RESULT, 7),
    "same",
    [CLOSE_SIGNED],
  ],
  [
    "idle + settled mismatch",
    IDLE,
    settled(MISMATCH_RESULT),
    "same",
    [CLOSE_SIGNED],
  ],
  [
    "mismatch + settled mismatch closes the late replay, not the one held",
    MISMATCH,
    settled({ ...REPORT, signed: OTHER_SIGNED, status: "mismatch" }),
    "same",
    [{ signed: OTHER_SIGNED, type: "close-signed" }],
  ],

  // failed: only the running check can fail.
  [
    "checking + failed",
    CHECKING,
    { message: "boom", run: 1, type: "failed" },
    FAILED,
    [],
  ],
  [
    "checking + failed from another run",
    CHECKING,
    { message: "boom", run: 7, type: "failed" },
    "same",
    [],
  ],

  // capture-changed: back to idle, stopping or closing what was held.
  ["idle + capture-changed", IDLE, { type: "capture-changed" }, "same", []],
  [
    "checking + capture-changed stops the check",
    CHECKING,
    { type: "capture-changed" },
    IDLE,
    [{ run: 1, type: "abort" }],
  ],
  [
    "verified + capture-changed",
    VERIFIED,
    { type: "capture-changed" },
    IDLE,
    [],
  ],
  [
    "mismatch + capture-changed closes the signed replay",
    MISMATCH,
    { type: "capture-changed" },
    IDLE,
    [CLOSE_SIGNED],
  ],
  [
    "unavailable + capture-changed",
    UNAVAILABLE,
    { type: "capture-changed" },
    IDLE,
    [],
  ],
  ["failed + capture-changed", FAILED, { type: "capture-changed" }, IDLE, []],
];

test.each(TABLE)("%s", (_name, state, event, next, effects) => {
  const step = transitionDocumentHistoryVerification(state, event);

  if (next === "same") {
    expect(step.state).toBe(state);
  } else {
    expect(step.state).toEqual(next);
  }
  expect(step.effects).toEqual(effects);
  // The replay held is the very one the result brought, not a copy.
  if (step.state.status === "mismatch" && next !== "same") {
    expect(step.state.signed).toBe(SIGNED);
  }
});

test("a settled check ignores progress, results, and failures", () => {
  const late: Event[] = [
    { progress: PROGRESS, run: 1, type: "progressed" },
    settled(VERIFIED_RESULT),
    settled({ reason: "offline", status: "unavailable" }),
    settled(null),
    { message: "late", run: 1, type: "failed" },
  ];
  for (const state of [IDLE, ...SETTLED_STATES]) {
    for (const event of late) {
      const step = transitionDocumentHistoryVerification(state, event);
      expect(step.state).toBe(state);
      expect(step.effects).toEqual([]);
    }
  }
});

function run(...events: Event[]): {
  effects: Effect[];
  state: State;
} {
  let state: State = IDLE;
  const effects: Effect[] = [];
  for (const event of events) {
    const step = transitionDocumentHistoryVerification(state, event);
    state = step.state;
    effects.push(...step.effects);
  }
  return { effects, state };
}

test("a check the capture left behind cannot settle the next one", () => {
  const next: Event = { captureVersion: CAPTURE, run: 2, type: "requested" };
  const outcome = run(
    { captureVersion: CAPTURE, run: 1, type: "requested" },
    { type: "capture-changed" },
    next,
    { progress: PROGRESS, run: 1, type: "progressed" },
    settled(MISMATCH_RESULT, 1),
    { message: "late", run: 1, type: "failed" },
  );

  expect(outcome.state).toEqual(CHECKING_AGAIN);
  // The first check was stopped, and the replay it still brought was closed.
  expect(outcome.effects).toEqual([{ run: 1, type: "abort" }, CLOSE_SIGNED]);
});

test("every signed replay a result brings is closed exactly once", () => {
  const outcome = run(
    { captureVersion: CAPTURE, run: 1, type: "requested" },
    settled(MISMATCH_RESULT, 1),
    { captureVersion: CAPTURE, run: 2, type: "requested" },
    settled({ ...REPORT, signed: OTHER_SIGNED, status: "mismatch" }, 2),
    { type: "capture-changed" },
  );

  expect(outcome.state).toBe(IDLE);
  expect(outcome.effects).toEqual([
    CLOSE_SIGNED,
    { signed: OTHER_SIGNED, type: "close-signed" },
  ]);
});
