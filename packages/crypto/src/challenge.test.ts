import { expect, test } from "bun:test";
import { authChallengeSigningBytes, generateChallenge } from "./challenge";

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

test("auth challenge signing bytes are domain-bound", () => {
  const challengeHex = "a".repeat(64);
  const fingerprint = "b".repeat(64);
  const encoded = new TextDecoder().decode(
    authChallengeSigningBytes({ challengeHex, fingerprint }),
  );

  expect(encoded).toContain("tearleads.auth.challenge.v1");
  expect(encoded).toContain(challengeHex);
  expect(encoded).toContain(fingerprint);
  expect(() =>
    authChallengeSigningBytes({ challengeHex: "abc", fingerprint }),
  ).toThrow("Authentication challenge must be canonical hex");
});
