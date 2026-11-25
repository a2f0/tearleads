import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { generateRecoveryCodes, recoveryCodeHash } from "./recoveryCodes";

const SCOPE = {
  serverSecret: "a-two-factor-secret-key-for-recovery-tests",
  userId: "11111111-1111-4111-8111-111111111111",
};

test("ten distinct recovery codes come with their hashes", () => {
  const { codes, hashes } = generateRecoveryCodes(SCOPE);

  expect(codes).toHaveLength(10);
  expect(new Set(codes).size).toBe(10);
  for (const code of codes) {
    expect(code).toMatch(/^[2-9a-hjkmnp-tv-z]{5}-[2-9a-hjkmnp-tv-z]{5}$/);
  }
  expect(codes.map((code) => recoveryCodeHash(code, SCOPE))).toEqual([
    ...hashes,
  ]);
});

test("a typed recovery code ignores case, spaces, and dashes", () => {
  const [code] = generateRecoveryCodes(SCOPE).codes;
  if (!code) throw new Error("expected a recovery code");
  const hash = recoveryCodeHash(code, SCOPE);

  expect(recoveryCodeHash(code.toUpperCase(), SCOPE)).toBe(hash);
  expect(recoveryCodeHash(code.replace("-", " "), SCOPE)).toBe(hash);
  expect(recoveryCodeHash(code.replace("-", ""), SCOPE)).toBe(hash);
});

test("a code's hash depends on the server secret and the user", () => {
  const code = "abcde-fghjk";
  const hash = recoveryCodeHash(code, SCOPE);

  // A database read alone cannot test a guess: the plain digest differs.
  expect(hash).not.toBe(
    createHash("sha256").update("abcdefghjk").digest("hex"),
  );
  expect(
    recoveryCodeHash(code, {
      ...SCOPE,
      serverSecret: `${SCOPE.serverSecret}!`,
    }),
  ).not.toBe(hash);
  expect(
    recoveryCodeHash(code, {
      ...SCOPE,
      userId: "22222222-2222-4222-8222-222222222222",
    }),
  ).not.toBe(hash);
});

test("strings that cannot be recovery codes have no hash", () => {
  expect(recoveryCodeHash("abcde-fghj", SCOPE)).toBeNull();
  expect(recoveryCodeHash("abcde-fghjkm", SCOPE)).toBeNull();
  expect(recoveryCodeHash("12345-6789a", SCOPE)).toBeNull();
  expect(recoveryCodeHash("o2345-6789a", SCOPE)).toBeNull();
});
