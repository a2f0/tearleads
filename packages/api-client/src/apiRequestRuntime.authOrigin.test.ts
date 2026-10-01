import { afterEach, expect, test } from "bun:test";
import { authChallengeSigningBytes } from "@tearleads/crypto";
import { ApiRequestRuntime } from "./apiRequestRuntime";

const challengeHex = "a".repeat(64);
const fingerprint = "b".repeat(64);

function bytesFor(apiOrigin: string): Uint8Array {
  return authChallengeSigningBytes({ apiOrigin, challengeHex, fingerprint });
}

function setPage(href: string | undefined): void {
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: href === undefined ? undefined : new URL(href),
  });
}

afterEach(() => {
  setPage(undefined);
});

test("an absolute base URL signs for its own origin, not its path", () => {
  const runtime = new ApiRequestRuntime("https://api.example.test/v1/");
  expect(runtime.authChallengeBytes(challengeHex, fingerprint)).toEqual(
    bytesFor("https://api.example.test"),
  );
});

test("a relative or empty base URL signs for the page it resolves against", () => {
  setPage("https://app.example.test/workspace");
  for (const base of ["/api", ""]) {
    expect(
      new ApiRequestRuntime(base).authChallengeBytes(challengeHex, fingerprint),
    ).toEqual(bytesFor("https://app.example.test"));
  }
});

test("a relative base URL with no page has no API origin to sign for", () => {
  expect(() =>
    new ApiRequestRuntime("/api").authChallengeBytes(challengeHex, fingerprint),
  ).toThrow("The API origin is unavailable for authentication");
});
