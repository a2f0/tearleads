import { describe, expect, test } from "bun:test";
import {
  IDENTITY_ACCOUNT_BINDING_UNKNOWN,
  type IdentityAccountBinding,
  type LegalTermsRequirementInput,
  legalTermsRequirement,
  transitionIdentityAccountBinding,
} from "./legalTermsRequirement";

const RESTORED: LegalTermsRequirementInput = {
  agreed: false,
  binding: IDENTITY_ACCOUNT_BINDING_UNKNOWN,
  identityRestored: true,
  recovered: false,
  signingFingerprint: "fingerprint-a",
};

function known(fingerprint: string, bound: boolean): IdentityAccountBinding {
  return { bound, fingerprint, status: "known" };
}

describe("legalTermsRequirement", () => {
  test("an agreement, or an identity recovered from its passphrase, needs nothing more", () => {
    expect(legalTermsRequirement({ ...RESTORED, agreed: true })).toBe(
      "not-required",
    );
    expect(legalTermsRequirement({ ...RESTORED, recovered: true })).toBe(
      "not-required",
    );
  });

  test("a key made on this page asks without reading any binding", () => {
    expect(
      legalTermsRequirement({ ...RESTORED, identityRestored: false }),
    ).toBe("required");
  });

  test("a stored key asks only once the device says no account holds it", () => {
    expect(legalTermsRequirement(RESTORED)).toBe("checking");
    expect(
      legalTermsRequirement({
        ...RESTORED,
        binding: known("fingerprint-a", false),
      }),
    ).toBe("required");
    expect(
      legalTermsRequirement({
        ...RESTORED,
        binding: known("fingerprint-a", true),
      }),
    ).toBe("not-required");
    // Another key's answer says nothing about this one.
    expect(
      legalTermsRequirement({
        ...RESTORED,
        binding: known("fingerprint-b", true),
      }),
    ).toBe("checking");
  });
});

describe("transitionIdentityAccountBinding", () => {
  test("only the latest lookup settles the binding", () => {
    const first = Symbol("first");
    const second = Symbol("second");
    let state = transitionIdentityAccountBinding(
      IDENTITY_ACCOUNT_BINDING_UNKNOWN,
      { fingerprint: "fingerprint-a", request: first, type: "check-started" },
    );
    state = transitionIdentityAccountBinding(state, {
      fingerprint: "fingerprint-b",
      request: second,
      type: "check-started",
    });
    const superseded = transitionIdentityAccountBinding(state, {
      bound: true,
      request: first,
      type: "check-settled",
    });
    expect(superseded).toBe(state);
    expect(
      transitionIdentityAccountBinding(state, {
        bound: false,
        request: second,
        type: "check-settled",
      }),
    ).toEqual(known("fingerprint-b", false));
  });

  test("a settled lookup leaves a later one's result alone", () => {
    const settled = known("fingerprint-a", true);
    expect(
      transitionIdentityAccountBinding(settled, {
        bound: false,
        request: Symbol("stale"),
        type: "check-settled",
      }),
    ).toBe(settled);
  });
});
