import { expect, test } from "bun:test";
import {
  RUNTIME_RESTART_NOTICE_OFFERED,
  type RuntimeRestartNoticeStep,
  transitionRuntimeRestartNotice,
} from "./runtimeRestartNoticeMachine";

const SAVING: RuntimeRestartNoticeStep = { attempt: 1, status: "saving" };
const UNSAVED: RuntimeRestartNoticeStep = { attempt: 1, status: "unsaved" };
const PREPARING: RuntimeRestartNoticeStep = {
  attempt: 1,
  discard: false,
  status: "preparing",
};
const DISCARDING: RuntimeRestartNoticeStep = {
  attempt: 1,
  discard: true,
  status: "preparing",
};
const RELOADING: RuntimeRestartNoticeStep = { attempt: 1, status: "reloading" };

// Reload waits for edits to reach SQLite, then drains, or asks when edits
// would be lost.
test("a press saves first, then drains or asks", () => {
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
  ).toEqual(PREPARING);
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
  ).toEqual(DISCARDING);
  expect(
    transitionRuntimeRestartNotice(UNSAVED, { type: "keepConfirmed" }),
  ).toBe(RUNTIME_RESTART_NOTICE_OFFERED);
  expect(
    transitionRuntimeRestartNotice(RUNTIME_RESTART_NOTICE_OFFERED, {
      type: "discardConfirmed",
    }),
  ).toBe(RUNTIME_RESTART_NOTICE_OFFERED);
});

// Edits typed while the SDK drained would be lost too, so the notice asks
// again, unless the user already chose to discard edits.
test("edits made while draining ask again unless discarded", () => {
  const prepared = (unsaved: boolean) =>
    ({ attempt: 1, type: "prepared", unsaved }) as const;
  expect(transitionRuntimeRestartNotice(PREPARING, prepared(true))).toEqual(
    UNSAVED,
  );
  expect(transitionRuntimeRestartNotice(PREPARING, prepared(false))).toEqual(
    RELOADING,
  );
  expect(transitionRuntimeRestartNotice(DISCARDING, prepared(true))).toEqual(
    RELOADING,
  );
});

// Only the current attempt's work moves the notice. A reload keeps the
// notice waiting until the SDK asks again, the sign that the page was kept.
test("a stale attempt changes nothing", () => {
  expect(
    transitionRuntimeRestartNotice(SAVING, {
      attempt: 0,
      type: "settled",
      unsaved: false,
    }),
  ).toBe(SAVING);
  expect(
    transitionRuntimeRestartNotice(PREPARING, {
      attempt: 0,
      type: "prepared",
      unsaved: false,
    }),
  ).toBe(PREPARING);
  expect(
    transitionRuntimeRestartNotice(RELOADING, { attempt: 0, type: "pageKept" }),
  ).toBe(RELOADING);
  expect(
    transitionRuntimeRestartNotice(RELOADING, { attempt: 1, type: "pageKept" }),
  ).toBe(RUNTIME_RESTART_NOTICE_OFFERED);
  expect(
    transitionRuntimeRestartNotice(PREPARING, { attempt: 1, type: "pageKept" }),
  ).toBe(PREPARING);
});
