import { expect } from "bun:test";
import type { KeyingVerificationCode, KeyingVerificationResult } from "./index";

export function expectVerificationError<T>(
  result: KeyingVerificationResult<T>,
  code: KeyingVerificationCode,
) {
  if (result.ok) {
    throw new Error("Expected verification to fail");
  }

  expect(result.error.code).toBe(code);
}
