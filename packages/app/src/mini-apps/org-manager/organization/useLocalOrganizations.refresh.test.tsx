import { afterEach, expect, mock, test } from "bun:test";
import {
  createDomainScope,
  type LocalOrganizationSummary,
} from "@tearleads/client-sdk";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { useLocalOrganizations } from "./useLocalOrganizations";

afterEach(() => cleanup());

const ORGANIZATION_A: LocalOrganizationSummary = {
  name: "Acme",
  organizationId: "org-a",
  rootContainerId: "container-a",
};
const ORGANIZATION_B: LocalOrganizationSummary = {
  name: "Beta",
  organizationId: "org-b",
  rootContainerId: "container-b",
};

test("reloads when the organization index refresh key changes", async () => {
  let organizations = [ORGANIZATION_A];
  const listLocalOrganizations = mock(async () => organizations);
  const scopeKey = createDomainScope();
  const view = renderHook(
    ({ refreshKey }: { refreshKey: string }) =>
      useLocalOrganizations({
        activeOrganization: null,
        databaseReady: true,
        enabled: true,
        listLocalOrganizations,
        refreshKey,
        scopeKey,
      }),
    { initialProps: { refreshKey: "organization-index-a" } },
  );

  await waitFor(() => {
    expect(view.result.current.organizations).toEqual([ORGANIZATION_A]);
  });

  organizations = [ORGANIZATION_A, ORGANIZATION_B];
  view.rerender({ refreshKey: "organization-index-b" });

  await waitFor(() => {
    expect(listLocalOrganizations).toHaveBeenCalledTimes(2);
    expect(view.result.current.organizations).toEqual([
      ORGANIZATION_A,
      ORGANIZATION_B,
    ]);
  });
});

test("refreshes a populated list without blinking the loading status", async () => {
  let organizations = [ORGANIZATION_A];
  const listLocalOrganizations = mock(async () => organizations);
  const scopeKey = createDomainScope();
  const view = renderHook(
    ({ refreshKey }: { refreshKey: string }) =>
      useLocalOrganizations({
        activeOrganization: null,
        databaseReady: true,
        enabled: true,
        listLocalOrganizations,
        refreshKey,
        scopeKey,
      }),
    { initialProps: { refreshKey: "organization-index-a" } },
  );

  await waitFor(() => {
    expect(view.result.current.organizations).toEqual([ORGANIZATION_A]);
    expect(view.result.current.organizationsLoading).toBe(false);
  });

  organizations = [ORGANIZATION_A, ORGANIZATION_B];
  view.rerender({ refreshKey: "organization-index-b" });

  // The list is already on screen, so a refresh-key change stays silent rather
  // than blinking "Loading organizations..." on every organization-profile
  // document emission.
  expect(view.result.current.organizationsLoading).toBe(false);

  await waitFor(() => {
    expect(view.result.current.organizations).toEqual([
      ORGANIZATION_A,
      ORGANIZATION_B,
    ]);
    expect(view.result.current.organizationsLoading).toBe(false);
  });
});
