import { expect, test } from "bun:test";
import {
  encodeBase32,
  matchTotpStep,
  normalizeTotpCode,
  totpCode,
  totpStep,
  totpUri,
} from "./totp";

/** The RFC 6238 appendix B SHA-1 seed. */
const RFC_SECRET = new TextEncoder().encode("12345678901234567890");

test("codes match the RFC 6238 SHA-1 vectors, truncated to six digits", () => {
  for (const [seconds, code] of [
    [59, "287082"],
    [1_111_111_109, "081804"],
    [1_111_111_111, "050471"],
    [1_234_567_890, "005924"],
    [2_000_000_000, "279037"],
  ] as const) {
    expect(totpCode(RFC_SECRET, totpStep(seconds * 1000))).toBe(code);
  }
});

test("base32 encodes without padding", () => {
  expect(encodeBase32(RFC_SECRET)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  expect(encodeBase32(new TextEncoder().encode("f"))).toBe("MY");
});

test("typed codes keep only six digits", () => {
  expect(normalizeTotpCode(" 287 082 ")).toBe("287082");
  expect(normalizeTotpCode("287-082")).toBe("287082");
  expect(normalizeTotpCode("28708")).toBeNull();
  expect(normalizeTotpCode("28708a")).toBeNull();
});

test("a code matches within one step of drift and never twice", () => {
  const nowMs = 1_111_111_109_000;
  const step = totpStep(nowMs);
  const at = (offset: number) => totpCode(RFC_SECRET, step + offset);

  for (const offset of [-1, 0, 1]) {
    expect(
      matchTotpStep({
        code: at(offset),
        lastUsedStep: null,
        nowMs,
        secret: RFC_SECRET,
      }),
    ).toBe(step + offset);
  }
  for (const offset of [-2, 2]) {
    expect(
      matchTotpStep({
        code: at(offset),
        lastUsedStep: null,
        nowMs,
        secret: RFC_SECRET,
      }),
    ).toBeNull();
  }
  // Replay protection: the accepted step and every earlier one are spent.
  expect(
    matchTotpStep({
      code: at(0),
      lastUsedStep: step,
      nowMs,
      secret: RFC_SECRET,
    }),
  ).toBeNull();
  expect(
    matchTotpStep({
      code: at(1),
      lastUsedStep: step,
      nowMs,
      secret: RFC_SECRET,
    }),
  ).toBe(step + 1);
});

test("the otpauth URI carries the label, issuer, and parameters", () => {
  const uri = new URL(
    totpUri({
      accountName: "ab12cd34",
      issuer: "Tearleads",
      secret: RFC_SECRET,
    }),
  );
  expect(uri.protocol).toBe("otpauth:");
  expect(uri.host).toBe("totp");
  expect(decodeURIComponent(uri.pathname)).toBe("/Tearleads:ab12cd34");
  expect(Object.fromEntries(uri.searchParams)).toEqual({
    algorithm: "SHA1",
    digits: "6",
    issuer: "Tearleads",
    period: "30",
    secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  });
});
