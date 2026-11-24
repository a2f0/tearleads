import { expect, test } from "bun:test";
import {
  RUNTIME_RESTART_NOTICE_OFFERED,
  type RuntimeRestartNoticeStep,
  transitionRuntimeRestartNotice,
} from "./runtimeRestartNoticeMachine";

const SAVING: RuntimeRestartNoticeStep = { attempt: 1, status: "saving" };
const UNSAVED: RuntimeRestartNoticeStep = { attempt: 1, status: "unsaved" };
const RELOADING: RuntimeRestartNoticeStep = { attempt: 1, status: "reloading" };

// Reload waits for edits to reach SQLite, then reloads, or asks when edits
// would be lost.
test("a press saves first, then reloads or asks", () => {
  expect(
    transitionRuntimeRestartNotice(RUNTIME_RESTART_NOTICE_OFFERED, {
      attempt: 1,
      type: "reloadPressed",
    }),
  ).toEqual(SAVING);
  expect(
    transitionRuntimeRestartNotice(SAVING, {
      attempt: 1,
      type: "settled",
      unsaved: false,
    }),
  ).toEqual(RELOADING);
  expect(
    transitionRuntimeRestartNotice(SAVING, {
      attempt: 1,
      type: "settled",
      unsaved: true,
    }),
  ).toEqual(UNSAVED);
  expect(
    transitionRuntimeRestartNotice(SAVING, {
      attempt: 2,
      type: "reloadPressed",
    }),
  ).toBe(SAVING);
});

// Asked, the user either discards the edits by reloading or keeps them.
test("unsaved edits wait for the user's answer", () => {
  expect(
    transitionRuntimeRestartNotice(UNSAVED, { type: "discardConfirmed" }),
  ).toEqual(RELOADING);
  expect(
    transitionRuntimeRestartNotice(UNSAVED, { type: "keepConfirmed" }),
  ).toBe(RUNTIME_RESTART_NOTICE_OFFERED);
  expect(
    transitionRuntimeRestartNotice(RUNTIME_RESTART_NOTICE_OFFERED, {
      type: "discardConfirmed",
    }),
  ).toBe(RUNTIME_RESTART_NOTICE_OFFERED);
});

// Only the current attempt's work moves the notice, and a page its user
// kept after the reload began offers Reload again.
test("a stale attempt changes nothing", () => {
  expect(
    transitionRuntimeRestartNotice(SAVING, {
      attempt: 0,
      type: "settled",
      unsaved: false,
    }),
  ).toBe(SAVING);
  expect(
    transitionRuntimeRestartNotice(RELOADING, {
      attempt: 0,
      type: "reloadReturned",
    }),
  ).toBe(RELOADING);
  expect(
    transitionRuntimeRestartNotice(RELOADING, {
      attempt: 1,
      type: "reloadReturned",
    }),
  ).toBe(RUNTIME_RESTART_NOTICE_OFFERED);
});
