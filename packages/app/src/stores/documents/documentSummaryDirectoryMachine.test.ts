import { expect, test } from "bun:test";
import {
  DIRECTORY_IDLE,
  type DocumentSummaryDirectoryState,
  type DocumentSummaryDirectoryEvent as Event,
  transitionDocumentSummaryDirectory,
} from "./documentSummaryDirectoryMachine";

type Status = DocumentSummaryDirectoryState["status"];
type EventType = Event["type"];

const statuses: readonly Status[] = [
  "idle",
  "loading",
  "loading-with-reload",
  "disposed",
];

/** Expected next status per state and event; `null` means ignored. */
const table: Record<Status, Record<EventType, Status | null>> = {
  idle: {
    "load-requested": "loading",
    persisted: null,
    "pass-started": null,
    "loop-finished": null,
    disposed: "disposed",
  },
  loading: {
    "load-requested": "loading-with-reload",
    persisted: "loading-with-reload",
    "pass-started": null,
    "loop-finished": "idle",
    disposed: "disposed",
  },
  "loading-with-reload": {
    "load-requested": null,
    persisted: null,
    "pass-started": "loading",
    "loop-finished": "idle",
    disposed: "disposed",
  },
  disposed: {
    "load-requested": null,
    persisted: null,
    "pass-started": null,
    "loop-finished": null,
    disposed: null,
  },
};

const eventTypes: readonly EventType[] = [
  "load-requested",
  "persisted",
  "pass-started",
  "loop-finished",
  "disposed",
];

const cases = statuses.flatMap((status) =>
  eventTypes.map((type) => [status, type, table[status][type]] as const),
);

test.each(cases)("%s + %s -> %s", (status, type, next) => {
  const state: DocumentSummaryDirectoryState = { status };
  const event: Event = { type };
  const result = transitionDocumentSummaryDirectory(state, event);
  if (next === null) {
    expect(result).toBe(state);
  } else {
    expect(result).toEqual({ status: next });
  }
});

test("the table covers every state and event", () => {
  expect(cases).toHaveLength(20);
});

test("live writes and requests during one query coalesce into one more pass", () => {
  const events: Event[] = [
    { type: "load-requested" },
    { type: "pass-started" },
    { type: "persisted" },
    { type: "load-requested" },
    { type: "persisted" },
  ];
  const queued = events.reduce(
    transitionDocumentSummaryDirectory,
    DIRECTORY_IDLE,
  );
  expect(queued).toEqual({ status: "loading-with-reload" });
  const secondPass = transitionDocumentSummaryDirectory(queued, {
    type: "pass-started",
  });
  expect(secondPass).toEqual({ status: "loading" });
  expect(
    transitionDocumentSummaryDirectory(secondPass, { type: "loop-finished" }),
  ).toBe(DIRECTORY_IDLE);
});

test("a loop that finishes after disposal cannot revive the subscription", () => {
  const events: Event[] = [
    { type: "load-requested" },
    { type: "persisted" },
    { type: "disposed" },
    { type: "loop-finished" },
    { type: "load-requested" },
  ];
  expect(
    events.reduce(transitionDocumentSummaryDirectory, DIRECTORY_IDLE),
  ).toEqual({ status: "disposed" });
});
