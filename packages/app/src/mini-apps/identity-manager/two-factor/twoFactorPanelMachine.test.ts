import { expect, test } from "bun:test";
import {
  INITIAL_TWO_FACTOR_PANEL_STATE,
  type TwoFactorPanelEvent,
  type TwoFactorPanelState,
  transitionTwoFactorPanel,
} from "./twoFactorPanelMachine";

const SETUP = { otpauthUri: "otpauth://totp/Tearleads:x", secret: "ABCD" };
const OFF_STATUS = {
  enabled: false,
  recoveryCodesRemaining: 0,
  requiredByOrganizationIds: ["org-1"],
  sessionVerified: false,
};

function run(
  events: readonly TwoFactorPanelEvent[],
  from: TwoFactorPanelState = INITIAL_TWO_FACTOR_PANEL_STATE,
): TwoFactorPanelState {
  return events.reduce(transitionTwoFactorPanel, from);
}

test("setup keeps the organizations requiring it, and cancelling returns to off", () => {
  const settingUp = run([
    { current: OFF_STATUS, type: "loaded" },
    { setup: SETUP, type: "setup-started" },
  ]);
  expect(settingUp).toEqual({
    requiredByOrganizationIds: ["org-1"],
    setup: SETUP,
    status: "setting-up",
  });
  expect(run([{ type: "setup-cancelled" }], settingUp)).toEqual({
    requiredByOrganizationIds: ["org-1"],
    status: "off",
  });
});

test("new codes show once, then a reload reports two-factor on", () => {
  const shown = run([
    { current: OFF_STATUS, type: "loaded" },
    { setup: SETUP, type: "setup-started" },
    { recoveryCodes: ["a", "b"], type: "codes-issued" },
  ]);
  expect(shown).toEqual({ recoveryCodes: ["a", "b"], status: "showing-codes" });

  const on = {
    ...OFF_STATUS,
    enabled: true,
    recoveryCodesRemaining: 2,
    requiredByOrganizationIds: [],
    sessionVerified: true,
  };
  expect(
    run([{ type: "load" }, { current: on, type: "loaded" }], shown),
  ).toEqual({ current: on, status: "on" });
});

test("a failure only replaces a load in flight", () => {
  expect(run([{ message: "offline", type: "failed" }])).toEqual({
    message: "offline",
    status: "failed",
  });
  const off = run([{ current: OFF_STATUS, type: "loaded" }]);
  expect(run([{ message: "late", type: "failed" }], off)).toBe(off);
  // Setup starts only from off; a stale answer while codes show is ignored.
  const shown = run([{ recoveryCodes: ["a"], type: "codes-issued" }], off);
  expect(run([{ setup: SETUP, type: "setup-started" }], shown)).toBe(shown);
});

test("turning off forgets the organizations requiring it", () => {
  expect(run([{ type: "disabled" }])).toEqual({
    requiredByOrganizationIds: [],
    status: "off",
  });
});
