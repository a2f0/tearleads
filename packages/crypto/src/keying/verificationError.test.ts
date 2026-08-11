import { expect, test } from "bun:test";
import {
  isKeyingVerificationCode,
  KEYING_VERIFICATION_CODES,
} from "@tearleads/crypto";

test("the public verification-code registry matches the runtime predicate", () => {
  expect(KEYING_VERIFICATION_CODES).not.toHaveLength(0);
  for (const code of KEYING_VERIFICATION_CODES) {
    expect(isKeyingVerificationCode(code)).toBe(true);
  }
  expect(isKeyingVerificationCode("future_code")).toBe(false);
});
