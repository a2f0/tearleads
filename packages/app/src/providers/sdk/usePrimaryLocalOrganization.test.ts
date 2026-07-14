import { afterEach, expect, mock, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  resolveContactsBootstrapPolicy,
  usePrimaryLocalOrganization,
} from "./usePrimaryLocalOrganization";

afterEach(cleanup);

const PERSONAL_ORGANIZATION = {
  name: "Personal Org",
  organizationId: "personal-org",
  rootContainerId: "personal-root",
};

const FOREIGN_ORGANIZATION = {
  name: "Foreign Org",
  organizationId: "foreign-org",
  rootContainerId: "foreign-root",
};

test("explicit default organization wins over a foreign-first local index", () => {
  const listLocalOrganizations = mock(async () => [
    FOREIGN_ORGANIZATION,
    PERSONAL_ORGANIZATION,
  ]);
  const tearleads = {
    organizations: { listLocalOrganizations },
  } as unknown as Tearleads;
  const view = renderHook(() =>
    usePrimaryLocalOrganization({
      defaultOrganizationId: PERSONAL_ORGANIZATION.organizationId,
      enabled: true,
      refreshKey: "foreign-root:personal-root",
      tearleads,
    }),
  );

  expect(view.result.current).toEqual({
    organizationId: PERSONAL_ORGANIZATION.organizationId,
    ready: true,
  });
  expect(listLocalOrganizations).toHaveBeenCalledTimes(0);
});

test("legacy lookup is loading on the first render after it is enabled", async () => {
  let resolveLookup:
    | ((organizations: (typeof PERSONAL_ORGANIZATION)[]) => void)
    | undefined;
  const listLocalOrganizations = mock(
    () =>
      new Promise<(typeof PERSONAL_ORGANIZATION)[]>((resolve) => {
        resolveLookup = resolve;
      }),
  );
  const tearleads = {
    organizations: { listLocalOrganizations },
  } as unknown as Tearleads;
  const renders: Array<{
    organizationId: string | null;
    ready: boolean;
  }> = [];
  const view = renderHook(
    ({ enabled }) => {
      const state = usePrimaryLocalOrganization({
        defaultOrganizationId: null,
        enabled,
        refreshKey: "legacy-personal-root",
        tearleads,
      });
      renders.push(state);
      return state;
    },
    { initialProps: { enabled: false } },
  );

  renders.length = 0;
  view.rerender({ enabled: true });

  expect(renders[0]).toEqual({ organizationId: null, ready: false });
  expect(view.result.current).toEqual({ organizationId: null, ready: false });
  expect(listLocalOrganizations).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveLookup?.([PERSONAL_ORGANIZATION]);
  });
});

test("retries while the primary organization index catches up", async () => {
  let attempt = 0;
  const listLocalOrganizations = mock(async () => {
    attempt += 1;
    return attempt === 1 ? [] : [PERSONAL_ORGANIZATION];
  });
  const tearleads = {
    organizations: { listLocalOrganizations },
  } as unknown as Tearleads;
  const view = renderHook(
    ({ enabled }) =>
      usePrimaryLocalOrganization({
        defaultOrganizationId: null,
        enabled,
        refreshKey: enabled ? "personal-org:personal-root:stable" : "",
        tearleads,
      }),
    { initialProps: { enabled: false } },
  );

  view.rerender({ enabled: true });

  await waitFor(() => expect(listLocalOrganizations).toHaveBeenCalledTimes(1));
  expect(view.result.current).toEqual({
    organizationId: null,
    ready: false,
  });
  expect(
    resolveContactsBootstrapPolicy({
      currentOrganizationId: PERSONAL_ORGANIZATION.organizationId,
      isAuthenticated: true,
      primaryLocalOrganization: view.result.current,
    }),
  ).toBeNull();

  await waitFor(
    () => {
      expect(listLocalOrganizations).toHaveBeenCalledTimes(2);
      expect(view.result.current).toEqual({
        organizationId: PERSONAL_ORGANIZATION.organizationId,
        ready: true,
      });
      expect(
        resolveContactsBootstrapPolicy({
          currentOrganizationId: PERSONAL_ORGANIZATION.organizationId,
          isAuthenticated: true,
          primaryLocalOrganization: view.result.current,
        }),
      ).toBe(true);
    },
    { timeout: 1_500 },
  );
});

test("retries a transient primary organization lookup failure", async () => {
  let attempt = 0;
  const listLocalOrganizations = mock(async () => {
    attempt += 1;
    if (attempt === 1) {
      throw new Error("organization index is temporarily unavailable");
    }
    return [PERSONAL_ORGANIZATION];
  });
  const tearleads = {
    organizations: { listLocalOrganizations },
  } as unknown as Tearleads;
  const view = renderHook(() =>
    usePrimaryLocalOrganization({
      enabled: true,
      refreshKey: "personal-org:personal-root:stable",
      tearleads,
    }),
  );

  await waitFor(
    () => {
      expect(listLocalOrganizations).toHaveBeenCalledTimes(2);
      expect(view.result.current).toEqual({
        organizationId: PERSONAL_ORGANIZATION.organizationId,
        ready: true,
      });
    },
    { timeout: 1_500 },
  );
});

test("clears a resolved organization when the lookup scope changes", async () => {
  let attempt = 0;
  let resolveNextLookup:
    | ((organizations: (typeof PERSONAL_ORGANIZATION)[]) => void)
    | undefined;
  const listLocalOrganizations = mock(async () => {
    attempt += 1;
    if (attempt === 1) {
      return [PERSONAL_ORGANIZATION];
    }
    return new Promise<(typeof PERSONAL_ORGANIZATION)[]>((resolve) => {
      resolveNextLookup = resolve;
    });
  });
  const tearleads = {
    organizations: { listLocalOrganizations },
  } as unknown as Tearleads;
  const view = renderHook(
    ({ refreshKey }) =>
      usePrimaryLocalOrganization({ enabled: true, refreshKey, tearleads }),
    { initialProps: { refreshKey: "scope-one" } },
  );

  await waitFor(() =>
    expect(view.result.current).toEqual({
      organizationId: PERSONAL_ORGANIZATION.organizationId,
      ready: true,
    }),
  );

  view.rerender({ refreshKey: "scope-two" });
  await waitFor(() => {
    expect(listLocalOrganizations).toHaveBeenCalledTimes(2);
    expect(view.result.current).toEqual({
      organizationId: null,
      ready: false,
    });
  });

  await act(async () => {
    resolveNextLookup?.([PERSONAL_ORGANIZATION]);
  });
  await waitFor(() => expect(view.result.current.ready).toBe(true));
});

test("cancels a pending retry when the lookup scope changes", async () => {
  let attempt = 0;
  const listLocalOrganizations = mock(async () => {
    attempt += 1;
    return attempt === 1 ? [] : [PERSONAL_ORGANIZATION];
  });
  const tearleads = {
    organizations: { listLocalOrganizations },
  } as unknown as Tearleads;
  const view = renderHook(
    ({ refreshKey }) =>
      usePrimaryLocalOrganization({ enabled: true, refreshKey, tearleads }),
    { initialProps: { refreshKey: "scope-one" } },
  );

  await waitFor(() => expect(listLocalOrganizations).toHaveBeenCalledTimes(1));
  view.rerender({ refreshKey: "scope-two" });
  await waitFor(() => expect(listLocalOrganizations).toHaveBeenCalledTimes(2));
  await act(() => new Promise((resolve) => setTimeout(resolve, 600)));

  expect(listLocalOrganizations).toHaveBeenCalledTimes(2);
  expect(view.result.current.organizationId).toBe(
    PERSONAL_ORGANIZATION.organizationId,
  );
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
