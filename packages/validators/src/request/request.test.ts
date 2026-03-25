import { expect, test } from "bun:test";
import {
  isChallengeRequest,
  isPublicKeyRequest,
  isVerifyRequest,
} from "./index";

test("isPublicKeyRequest", () => {
  expect(
    isPublicKeyRequest({
      signingPublicKey: [1, 2, 3],
      encapsulationPublicKey: [4, 5, 6],
    }),
  ).toBe(true);
  expect(
    isPublicKeyRequest({
      signingPublicKey: [],
      encapsulationPublicKey: [],
    }),
  ).toBe(true);
  expect(
    isPublicKeyRequest({
      signingPublicKey: "not-array",
      encapsulationPublicKey: [1],
    }),
  ).toBe(false);
  expect(
    isPublicKeyRequest({
      signingPublicKey: [1],
      encapsulationPublicKey: ["a"],
    }),
  ).toBe(false);
  expect(isPublicKeyRequest({ signingPublicKey: [1] })).toBe(false);
  expect(isPublicKeyRequest({ encapsulationPublicKey: [1] })).toBe(false);
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
