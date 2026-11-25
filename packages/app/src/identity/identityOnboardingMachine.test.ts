import { expect, test } from "bun:test";
import {
  INITIAL_ONBOARDING,
  transitionIdentityOnboarding as move,
} from "./identityOnboardingMachine";

for (const [form, busy] of [
  ["naming-account", "creating-identity"],
  ["entering-passphrase", "restoring-identity"],
] as const) {
  test(`${form} supports back and retry and ignores duplicate or stale submissions`, () => {
    const request = Symbol();
    const start = { type: "submit", form, request } as const;
    expect(move(INITIAL_ONBOARDING, start)).toBe(INITIAL_ONBOARDING);
    const editing = move(INITIAL_ONBOARDING, { type: "navigate", phase: form });
    const back = { type: "navigate", phase: "choosing-identity" } as const;
    expect(move(editing, back)).toEqual(INITIAL_ONBOARDING);
    const pending = move(editing, start);
    expect(pending).toEqual({ status: busy, request });
    expect(move(pending, back)).toBe(pending);
    expect(move(pending, start)).toBe(pending);
    const failed = move(pending, { type: "finish", request, error: "Retry" });
    expect(failed).toEqual({ status: form, error: "Retry" });
    const retry = Symbol();
    const retrying = move(failed, { ...start, request: retry });
    expect(move(retrying, { type: "finish", request })).toBe(retrying);
    expect(move(retrying, { type: "finish", request: retry })).toEqual(
      form === "naming-account"
        ? { status: "confirming-backup" }
        : INITIAL_ONBOARDING,
    );
  });
}

test("a created identity waits for its backup agreement and cannot be navigated away from", () => {
  const request = Symbol();
  const creating = move(
    move(INITIAL_ONBOARDING, { type: "navigate", phase: "naming-account" }),
    { type: "submit", form: "naming-account", request },
  );
  const confirming = move(creating, { type: "finish", request });
  expect(confirming).toEqual({ status: "confirming-backup" });
  for (const phase of [
    "choosing-identity",
    "naming-account",
    "entering-passphrase",
  ] as const) {
    expect(move(confirming, { type: "navigate", phase })).toBe(confirming);
  }
  expect(
    move(confirming, { type: "submit", form: "naming-account", request }),
  ).toBe(confirming);
  expect(move(confirming, { type: "finish", request })).toBe(confirming);
  expect(move(confirming, { type: "confirm-backup" })).toEqual(
    INITIAL_ONBOARDING,
  );
  // Only a pending backup can be confirmed.
  expect(move(INITIAL_ONBOARDING, { type: "confirm-backup" })).toBe(
    INITIAL_ONBOARDING,
  );
  expect(move(creating, { type: "confirm-backup" })).toBe(creating);
});

test("agreeing to the legal terms leads to naming, and only agreement leaves for it", () => {
  const accepting = move(INITIAL_ONBOARDING, {
    type: "navigate",
    phase: "accepting-terms",
  });
  expect(accepting).toEqual({ status: "accepting-terms" });
  // Naming, restoring, and submitting all wait for the agreement.
  for (const phase of ["naming-account", "entering-passphrase"] as const) {
    expect(move(accepting, { type: "navigate", phase })).toBe(accepting);
  }
  expect(
    move(accepting, {
      type: "submit",
      form: "naming-account",
      request: Symbol(),
    }),
  ).toBe(accepting);
  expect(
    move(accepting, { type: "navigate", phase: "choosing-identity" }),
  ).toEqual(INITIAL_ONBOARDING);
  expect(move(accepting, { type: "terms-agreed" })).toEqual({
    status: "naming-account",
  });
  // Agreement moves nothing else.
  expect(move(INITIAL_ONBOARDING, { type: "terms-agreed" })).toBe(
    INITIAL_ONBOARDING,
  );
  const naming = move(INITIAL_ONBOARDING, {
    type: "navigate",
    phase: "naming-account",
  });
  expect(move(naming, { type: "terms-agreed" })).toBe(naming);
});
