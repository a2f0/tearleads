import { expect, test } from "bun:test";
import {
  authChallengeSigningBytes,
  canonicalAuthOrigin,
  generateChallenge,
} from "./challenge";

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
  const apiOrigin = "https://api.example.test";
  const challengeHex = "a".repeat(64);
  const fingerprint = "b".repeat(64);
  const encoded = new TextDecoder().decode(
    authChallengeSigningBytes({ apiOrigin, challengeHex, fingerprint }),
  );

  expect(encoded).toBe(
    `{"domain":"tearleads.auth.challenge.v2","payload":{"apiOrigin":"${apiOrigin}","challenge":"${challengeHex}","fingerprint":"${fingerprint}"}}`,
  );
  expect(() =>
    authChallengeSigningBytes({ apiOrigin, challengeHex: "abc", fingerprint }),
  ).toThrow("Authentication challenge must be canonical hex");
  expect(() =>
    authChallengeSigningBytes({
      apiOrigin,
      challengeHex: "A".repeat(64),
      fingerprint,
    }),
  ).toThrow("Authentication challenge must be canonical hex");
  expect(() =>
    authChallengeSigningBytes({
      apiOrigin,
      challengeHex,
      fingerprint: "B".repeat(64),
    }),
  ).toThrow("Authentication fingerprint must be a SHA-256 hex string");
});

test("a challenge signed for one API origin is not the bytes of another", () => {
  const input = { challengeHex: "a".repeat(64), fingerprint: "b".repeat(64) };
  expect(
    authChallengeSigningBytes({ ...input, apiOrigin: "https://api.a.test" }),
  ).not.toEqual(
    authChallengeSigningBytes({ ...input, apiOrigin: "https://api.b.test" }),
  );
  expect(() =>
    authChallengeSigningBytes({ ...input, apiOrigin: "https://api.a.test/" }),
  ).toThrow("Authentication origin must be canonical");
});

test("the authentication origin is the scheme, host and port alone", () => {
  expect(canonicalAuthOrigin("https://api.a.test/v1/")).toBe(
    "https://api.a.test",
  );
  expect(canonicalAuthOrigin("http://127.0.0.1:3001")).toBe(
    "http://127.0.0.1:3001",
  );
  expect(() => canonicalAuthOrigin("/api")).toThrow("absolute URL");
  expect(() => canonicalAuthOrigin("ftp://api.a.test")).toThrow(
    "http or https",
  );
});
