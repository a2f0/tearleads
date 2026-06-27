import { expect, test } from "bun:test";
import { APP_HOST_PROFILES, resolveAppHostProfile } from "./AppHostConfig";

test("resolveAppHostProfile returns the app profile when the variant is unset", () => {
  expect(resolveAppHostProfile(undefined)).toBe(APP_HOST_PROFILES.app);
});

test("resolveAppHostProfile treats an empty string as unset", () => {
  // Some bundlers emit "" for an unset env var rather than undefined; that must
  // fall back to the default profile instead of crashing startup.
  expect(resolveAppHostProfile("")).toBe(APP_HOST_PROFILES.app);
});

test("resolveAppHostProfile resolves a known variant id", () => {
  expect(resolveAppHostProfile("app")).toBe(APP_HOST_PROFILES.app);
  expect(resolveAppHostProfile("demo")).toBe(APP_HOST_PROFILES.demo);
});

test("app and demo profiles auto-provision identities", () => {
  // Both productionized variants derive a key pair and register + log in on
  // boot; the autopilot reads these flags.
  for (const profile of [APP_HOST_PROFILES.app, APP_HOST_PROFILES.demo]) {
    expect(profile.features.autoGenerateIdentity).toBe(true);
    expect(profile.features.autoRegisterIdentity).toBe(true);
  }
});

test("resolveAppHostProfile throws on an unknown variant id", () => {
  // Fail closed: a misconfigured variant must surface loudly rather than
  // silently shipping the wrong profile to a domain.
  expect(() => resolveAppHostProfile("notes")).toThrow(
    "Unknown app host variant: notes",
  );
});
