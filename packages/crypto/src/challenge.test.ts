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

  expect(encoded).toBe(
    `{"domain":"symcrypt.auth.challenge.v1","payload":{"challenge":"${challengeHex}","fingerprint":"${fingerprint}"}}`,
  );
  expect(() =>
    authChallengeSigningBytes({ challengeHex: "abc", fingerprint }),
  ).toThrow("Authentication challenge must be canonical hex");
  expect(() =>
    authChallengeSigningBytes({
      challengeHex: "A".repeat(64),
      fingerprint,
    }),
  ).toThrow("Authentication challenge must be canonical hex");
  expect(() =>
    authChallengeSigningBytes({
      challengeHex,
      fingerprint: "B".repeat(64),
    }),
  ).toThrow("Authentication fingerprint must be a SHA-256 hex string");
});
