import { expect, test } from "bun:test";
import type { Quad } from "qr/decode.js";
import {
  INITIAL_RECOVERY_KEY_SCAN_STATE,
  LOCATED_HOLD_MS,
  REJECTED_HOLD_MS,
  type RecoveryKeyScanEvent,
  type RecoveryKeyScanState,
  type RecoveryQrFrame,
  transitionRecoveryKeyScan,
} from "./recoveryKeyScanState";

const size = { width: 640, height: 480 } as const;
const outline: Quad = [
  { x: 10, y: 10 },
  { x: 90, y: 10 },
  { x: 90, y: 90 },
  { x: 10, y: 90 },
];
const moved: Quad = [
  { x: 20, y: 20 },
  { x: 100, y: 20 },
  { x: 100, y: 100 },
  { x: 20, y: 100 },
];

function frame(
  at: number,
  code: { outline?: Quad; rejected?: boolean } = {},
  frameSize: { width: number; height: number } = size,
): RecoveryKeyScanEvent {
  const value: RecoveryQrFrame = {
    ...frameSize,
    at,
    outline: code.outline,
    rejected: code.rejected ?? false,
  };
  return { type: "frame", frame: value };
}

type StateOf<S extends RecoveryKeyScanState["status"]> = Extract<
  RecoveryKeyScanState,
  { status: S }
>;

const searching: StateOf<"searching"> = { status: "searching", frame: size };
const located: StateOf<"located"> = {
  status: "located",
  frame: size,
  outline,
  seenAt: 1000,
};
const rejected: StateOf<"rejected"> = {
  status: "rejected",
  frame: size,
  outline,
  seenAt: 1000,
  rejectedAt: 1000,
};
const failed: StateOf<"failed"> = { status: "failed", message: "denied" };

test.each([
  [
    "starting + empty frame",
    INITIAL_RECOVERY_KEY_SCAN_STATE,
    frame(0),
    searching,
  ],
  [
    "starting + located code",
    INITIAL_RECOVERY_KEY_SCAN_STATE,
    frame(5, { outline }),
    { status: "located", frame: size, outline, seenAt: 5 },
  ],
  [
    "searching + located code",
    searching,
    frame(7, { outline }),
    { status: "located", frame: size, outline, seenAt: 7 },
  ],
  [
    "searching + rejected code",
    searching,
    frame(9, { outline, rejected: true }),
    { status: "rejected", frame: size, outline, seenAt: 9, rejectedAt: 9 },
  ],
  [
    "located + moved code",
    located,
    frame(1100, { outline: moved }),
    { status: "located", frame: size, outline: moved, seenAt: 1100 },
  ],
  [
    "located + rejected code",
    located,
    frame(1100, { outline, rejected: true }),
    { ...rejected, seenAt: 1100, rejectedAt: 1100 },
  ],
  [
    "located + lost code after the hold",
    located,
    frame(1000 + LOCATED_HOLD_MS),
    searching,
  ],
  [
    "rejected + located code during the hold",
    rejected,
    frame(1200, { outline: moved }),
    { ...rejected, outline: moved, seenAt: 1200 },
  ],
  [
    "rejected + lost code after the outline hold",
    rejected,
    frame(1000 + LOCATED_HOLD_MS),
    { ...rejected, outline: undefined },
  ],
  [
    "rejected + another rejection",
    rejected,
    frame(1900, { outline: moved, rejected: true }),
    { ...rejected, outline: moved, seenAt: 1900, rejectedAt: 1900 },
  ],
  [
    "rejected + located code after the hold",
    rejected,
    frame(1000 + REJECTED_HOLD_MS, { outline: moved }),
    {
      status: "located",
      frame: size,
      outline: moved,
      seenAt: 1000 + REJECTED_HOLD_MS,
    },
  ],
  [
    "rejected + empty frame after the hold",
    rejected,
    frame(1000 + REJECTED_HOLD_MS),
    searching,
  ],
  [
    "searching + rotated frame",
    searching,
    frame(1, {}, { width: 480, height: 640 }),
    { status: "searching", frame: { width: 480, height: 640 } },
  ],
  [
    "located + rotated empty frame within the hold",
    located,
    frame(1100, {}, { width: 480, height: 640 }),
    { status: "searching", frame: { width: 480, height: 640 } },
  ],
  [
    "rejected + rotated empty frame within the hold",
    rejected,
    frame(1100, {}, { width: 480, height: 640 }),
    { ...rejected, frame: { width: 480, height: 640 }, outline: undefined },
  ],
  [
    "searching + camera failure",
    searching,
    { type: "fail", message: "lost" },
    { status: "failed", message: "lost" },
  ],
  [
    "starting + camera failure",
    INITIAL_RECOVERY_KEY_SCAN_STATE,
    { type: "fail", message: "denied" },
    failed,
  ],
] as const)("%s", (_name, state, event, next) => {
  expect(transitionRecoveryKeyScan(state, event)).toEqual(next);
});

test.each([
  ["searching + empty frame of the same size", searching, frame(50)],
  ["located + empty frame within the hold", located, frame(1100)],
  ["rejected + empty frame within the outline hold", rejected, frame(1100)],
  ["failed + located code", failed, frame(1, { outline })],
  ["failed + rejected code", failed, frame(1, { outline, rejected: true })],
  ["failed + a later failure", failed, { type: "fail", message: "other" }],
] as const)("%s keeps the same state", (_name, state, event) => {
  expect(transitionRecoveryKeyScan(state, event)).toBe(state);
});

test("a rejection stays visible while the wrong code flickers in and out of focus", () => {
  const events = [
    frame(0, { outline, rejected: true }),
    frame(100, { outline }),
    frame(200),
    frame(300, { outline }),
    frame(REJECTED_HOLD_MS - 1, { outline }),
  ];
  const state = events.reduce(
    transitionRecoveryKeyScan,
    INITIAL_RECOVERY_KEY_SCAN_STATE,
  );
  expect(state.status).toBe("rejected");
});

test("a camera failure cannot be hidden by frames still in flight", () => {
  const state = [
    frame(0, { outline }),
    { type: "fail", message: "Camera lost" } as const,
    frame(10, { outline, rejected: true }),
  ].reduce(transitionRecoveryKeyScan, INITIAL_RECOVERY_KEY_SCAN_STATE);
  expect(state).toEqual({ status: "failed", message: "Camera lost" });
});
