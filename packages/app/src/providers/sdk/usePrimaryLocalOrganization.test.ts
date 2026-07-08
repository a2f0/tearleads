import { expect, test } from "bun:test";
import { resolveContactsBootstrapPolicy } from "./usePrimaryLocalOrganization";

test("contacts bootstrap policy allows unauthenticated local bootstrap", () => {
  expect(
    resolveContactsBootstrapPolicy({
      currentOrganizationId: null,
      isAuthenticated: false,
      primaryLocalOrganization: { organizationId: null, ready: false },
    }),
  ).toBe(true);
});

test("contacts bootstrap policy waits while the primary organization is resolving", () => {
  expect(
    resolveContactsBootstrapPolicy({
      currentOrganizationId: "personal-org",
      isAuthenticated: true,
      primaryLocalOrganization: { organizationId: null, ready: false },
    }),
  ).toBeNull();
});

test("contacts bootstrap policy allows only the primary authenticated organization", () => {
  expect(
    resolveContactsBootstrapPolicy({
      currentOrganizationId: "personal-org",
      isAuthenticated: true,
      primaryLocalOrganization: { organizationId: "personal-org", ready: true },
    }),
  ).toBe(true);
  expect(
    resolveContactsBootstrapPolicy({
      currentOrganizationId: "custom-org",
      isAuthenticated: true,
      primaryLocalOrganization: { organizationId: "personal-org", ready: true },
    }),
  ).toBe(false);
});
