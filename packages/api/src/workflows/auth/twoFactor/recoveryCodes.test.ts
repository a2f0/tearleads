import { expect, test } from "bun:test";
import { generateRecoveryCodes, recoveryCodeHash } from "./recoveryCodes";

test("ten distinct recovery codes come with their hashes", () => {
  const { codes, hashes } = generateRecoveryCodes();

  expect(codes).toHaveLength(10);
  expect(new Set(codes).size).toBe(10);
  for (const code of codes) {
    expect(code).toMatch(/^[2-9a-hjkmnp-tv-z]{5}-[2-9a-hjkmnp-tv-z]{5}$/);
  }
  expect(codes.map(recoveryCodeHash)).toEqual([...hashes]);
});

test("a typed recovery code ignores case, spaces, and dashes", () => {
  const [code] = generateRecoveryCodes().codes;
  if (!code) throw new Error("expected a recovery code");
  const hash = recoveryCodeHash(code);

  expect(recoveryCodeHash(code.toUpperCase())).toBe(hash);
  expect(recoveryCodeHash(code.replace("-", " "))).toBe(hash);
  expect(recoveryCodeHash(code.replace("-", ""))).toBe(hash);
});

test("strings that cannot be recovery codes have no hash", () => {
  expect(recoveryCodeHash("abcde-fghj")).toBeNull();
  expect(recoveryCodeHash("abcde-fghjkm")).toBeNull();
  expect(recoveryCodeHash("12345-6789a")).toBeNull();
  expect(recoveryCodeHash("o2345-6789a")).toBeNull();
});
