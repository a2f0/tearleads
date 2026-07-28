import { expect, test } from "bun:test";
import { resolveMiniAppAccessGateState } from "./LocalKeyringUnlockGate";

test("mini-app access gate shows unlock before any local identity work", () => {
  expect(
    resolveMiniAppAccessGateState({
      hasSigningKeyPair: false,
      isLocked: true,
      localIdentityRestoreSettled: false,
    }),
  ).toBe("unlock");
});

test("mini-app access gate waits for local identity restore before setup", () => {
  expect(
    resolveMiniAppAccessGateState({
      hasSigningKeyPair: false,
      isLocked: false,
      localIdentityRestoreSettled: false,
    }),
  ).toBe("loading");
});

test("mini-app access gate requires local keys before mounting protected content", () => {
  expect(
    resolveMiniAppAccessGateState({
      hasSigningKeyPair: false,
      isLocked: false,
      localIdentityRestoreSettled: true,
    }),
  ).toBe("setup");

  expect(
    resolveMiniAppAccessGateState({
      hasSigningKeyPair: true,
      isLocked: false,
      localIdentityRestoreSettled: true,
    }),
  ).toBe("ready");
});

test("lock-only mini-app access stays available before local identity setup", () => {
  expect(
    resolveMiniAppAccessGateState({
      hasSigningKeyPair: false,
      isLocked: false,
      localIdentityRestoreSettled: false,
      requireLocalIdentity: false,
    }),
  ).toBe("ready");
  expect(
    resolveMiniAppAccessGateState({
      hasSigningKeyPair: false,
      isLocked: true,
      localIdentityRestoreSettled: false,
      requireLocalIdentity: false,
    }),
  ).toBe("unlock");
});
