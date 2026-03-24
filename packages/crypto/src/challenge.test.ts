import { expect, test } from "bun:test";
import { generateChallenge } from "./challenge";

test("generates 32 bytes by default", () => {
  const challenge = generateChallenge();
  expect(challenge).toBeInstanceOf(Uint8Array);
  expect(challenge.length).toBe(32);
});

test("generates custom length", () => {
  const challenge = generateChallenge(64);
  expect(challenge.length).toBe(64);
});

test("generates unique values", () => {
  const a = generateChallenge();
  const b = generateChallenge();
  expect(a).not.toEqual(b);
});
