import { expect, test } from "bun:test";
import {
  allowsRevenueCatSandboxEvents,
  readRevenueCatV2Credentials,
} from "./revenueCatConfig";

test("reads the v2 credential pair only when both halves are present", () => {
  expect(
    readRevenueCatV2Credentials({
      REVENUECAT_V2_SECRET_KEY: "sk_test",
      REVENUECAT_PROJECT_ID: "proj_test",
    }),
  ).toEqual({ secretKey: "sk_test", projectId: "proj_test" });
  expect(
    readRevenueCatV2Credentials({ REVENUECAT_V2_SECRET_KEY: "sk_test" }),
  ).toBeNull();
  expect(
    readRevenueCatV2Credentials({ REVENUECAT_PROJECT_ID: "proj_test" }),
  ).toBeNull();
  expect(readRevenueCatV2Credentials({})).toBeNull();
});

test("sandbox events are refused unless a tier explicitly opts in", () => {
  // Fails closed: an unset, empty, or non-"true" value keeps the tier
  // production-only, so a misconfigured deploy cannot hand out free sync to
  // anyone with a TestFlight build.
  expect(allowsRevenueCatSandboxEvents({})).toBe(false);
  expect(
    allowsRevenueCatSandboxEvents({ REVENUECAT_ALLOW_SANDBOX_EVENTS: "" }),
  ).toBe(false);
  expect(
    allowsRevenueCatSandboxEvents({ REVENUECAT_ALLOW_SANDBOX_EVENTS: "false" }),
  ).toBe(false);
  expect(
    allowsRevenueCatSandboxEvents({ REVENUECAT_ALLOW_SANDBOX_EVENTS: "1" }),
  ).toBe(false);
  expect(
    allowsRevenueCatSandboxEvents({ REVENUECAT_ALLOW_SANDBOX_EVENTS: "TRUE" }),
  ).toBe(false);
});

test("sandbox events are accepted on a tier that opts in", () => {
  expect(
    allowsRevenueCatSandboxEvents({ REVENUECAT_ALLOW_SANDBOX_EVENTS: "true" }),
  ).toBe(true);
  // Tier env files are hand-edited; trailing whitespace must not silently
  // disable the opt-in on staging.
  expect(
    allowsRevenueCatSandboxEvents({
      REVENUECAT_ALLOW_SANDBOX_EVENTS: "  true  ",
    }),
  ).toBe(true);
});
