import { expect, test } from "bun:test";
import {
  isChallengeRequest,
  isPublicKeyRequest,
  isVerifyRequest,
} from "./index";

test("isPublicKeyRequest", () => {
  expect(isPublicKeyRequest({ publicKey: [1, 2, 3] })).toBe(true);
  expect(isPublicKeyRequest({ publicKey: [] })).toBe(true);
  expect(isPublicKeyRequest({ publicKey: "not-array" })).toBe(false);
  expect(isPublicKeyRequest({ publicKey: ["a", "b"] })).toBe(false);
  expect(isPublicKeyRequest({})).toBe(false);
  expect(isPublicKeyRequest(null)).toBe(false);
});

test("isChallengeRequest", () => {
  expect(isChallengeRequest({ fingerprint: "abc" })).toBe(true);
  expect(isChallengeRequest({ fingerprint: 123 })).toBe(false);
  expect(isChallengeRequest({})).toBe(false);
  expect(isChallengeRequest(null)).toBe(false);
});

test("isVerifyRequest", () => {
  expect(isVerifyRequest({ fingerprint: "abc", signature: [1, 2] })).toBe(true);
  expect(isVerifyRequest({ fingerprint: "abc", signature: [] })).toBe(true);
  expect(isVerifyRequest({ fingerprint: "abc" })).toBe(false);
  expect(isVerifyRequest({ signature: [1, 2] })).toBe(false);
  expect(isVerifyRequest(null)).toBe(false);
});
