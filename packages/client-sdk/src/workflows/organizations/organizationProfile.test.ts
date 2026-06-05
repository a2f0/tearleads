import { expect, test } from "bun:test";
import { readOrganizationProfileName } from "./organizationProfile";

test("organization profile name reader tolerates unloaded fields", () => {
  expect(readOrganizationProfileName(null)).toBeNull();
  expect(readOrganizationProfileName(undefined)).toBeNull();
});

test("organization profile name reader trims non-empty names", () => {
  expect(readOrganizationProfileName({ name: "  Personal Org  " })).toBe(
    "Personal Org",
  );
  expect(readOrganizationProfileName({ name: "   " })).toBeNull();
});
