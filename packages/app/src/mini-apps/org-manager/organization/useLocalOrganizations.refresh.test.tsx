import { afterEach, expect, mock, test } from "bun:test";
import {
  createDomainScope,
  type LocalOrganizationSummary,
} from "@symcrypt/client-sdk";
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

test("retries until a late organization profile name resolves", async () => {
  // A re-hydrated identity lists its organizations before their profile
  // documents finish syncing, so the first read has no name to show. Nothing
  // else re-triggers the read here (the refresh key never changes), so the hook
  // has to catch the name up on its own instead of leaving the switcher pinned
  // to the unnamed label for the rest of the session.
  let attempt = 0;
  const listLocalOrganizations = mock(async () => {
    attempt += 1;
    return attempt === 1
      ? [{ ...ORGANIZATION_A, name: null }]
      : [ORGANIZATION_A];
  });
  const scopeKey = createDomainScope();
  const view = renderHook(() =>
    useLocalOrganizations({
      activeOrganization: null,
      databaseReady: true,
      enabled: true,
      listLocalOrganizations,
      refreshKey: "organization-index-a",
      scopeKey,
    }),
  );

  await waitFor(() => {
    expect(view.result.current.organizations).toEqual([
      { ...ORGANIZATION_A, name: null },
    ]);
  });
  await waitFor(
    () => {
      expect(view.result.current.organizations).toEqual([ORGANIZATION_A]);
    },
    { timeout: 1_500 },
  );
});
