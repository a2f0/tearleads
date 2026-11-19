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
      INITIAL_ONBOARDING,
    );
  });
}
