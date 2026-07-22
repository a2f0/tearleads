import { expect, test } from "bun:test";
import { MIN_PIN_CODE_LENGTH, pinCodePolicyError } from "./pinCodePolicy";

test("a PIN shorter than the minimum is rejected", () => {
  expect(pinCodePolicyError("")).toContain(String(MIN_PIN_CODE_LENGTH));
  expect(pinCodePolicyError("82491")).toContain(String(MIN_PIN_CODE_LENGTH));
});

test("a repeated single character is rejected at any length", () => {
  expect(pinCodePolicyError("111111")).toBe(
    "PIN code must not repeat a single character.",
  );
  expect(pinCodePolicyError("aaaaaaaa")).toBe(
    "PIN code must not repeat a single character.",
  );
});

test("a sequential run is rejected in either direction", () => {
  const expected = "PIN code must not be a sequential run of characters.";
  expect(pinCodePolicyError("123456")).toBe(expected);
  expect(pinCodePolicyError("654321")).toBe(expected);
  expect(pinCodePolicyError("abcdef")).toBe(expected);
});

test("a run that breaks its step is accepted", () => {
  expect(pinCodePolicyError("123457")).toBeNull();
  expect(pinCodePolicyError("124356")).toBeNull();
});

test("a mixed PIN at or above the minimum length is accepted", () => {
  expect(pinCodePolicyError("824913")).toBeNull();
  expect(pinCodePolicyError("correct horse")).toBeNull();
});
