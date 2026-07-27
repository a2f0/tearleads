import { afterEach, expect, test } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import {
  resolveContactsBootstrapPolicy,
  usePrimaryLocalOrganization,
} from "./usePrimaryLocalOrganization";

afterEach(cleanup);

test("the explicit default organization is the primary local organization", () => {
  const view = renderHook(() =>
    usePrimaryLocalOrganization({
      defaultOrganizationId: "personal-org",
      enabled: true,
    }),
  );

  expect(view.result.current).toEqual({
    organizationId: "personal-org",
    ready: true,
  });
});

test("reports ready without a primary while disabled", () => {
  const view = renderHook(() =>
    usePrimaryLocalOrganization({
      defaultOrganizationId: "personal-org",
      enabled: false,
    }),
  );

  expect(view.result.current).toEqual({ organizationId: null, ready: true });
});

test("waits while the default organization has not arrived", () => {
  const view = renderHook(() =>
    usePrimaryLocalOrganization({
      defaultOrganizationId: null,
      enabled: true,
    }),
  );

  expect(view.result.current).toEqual({ organizationId: null, ready: false });
  expect(
    resolveContactsBootstrapPolicy({
      currentOrganizationId: "personal-org",
      isAuthenticated: true,
      primaryLocalOrganization: view.result.current,
    }),
  ).toBeNull();
});

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
