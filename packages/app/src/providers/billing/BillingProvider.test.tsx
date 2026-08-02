import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type { OrganizationBilling } from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import * as CryptoSessionProvider from "../crypto/CryptoSessionProvider";
import * as TearleadsProvider from "../sdk/TearleadsProvider";
import {
  BillingProvider,
  syncBillingBlockAppliesToOrganization,
  useOrganizationBillingState,
} from "./BillingProvider";

afterEach(() => cleanup());

const DAY_MS = 24 * 60 * 60 * 1000;

function billing(
  overrides: Partial<OrganizationBilling> = {},
): OrganizationBilling {
  return {
    organizationId: "org-1",
    activeMemberCount: 1,
    status: "trialing",
    trialEndsAt: new Date(Date.now() + 3 * DAY_MS).toISOString(),
    provider: null,
    currentPeriodStartsAt: null,
    currentPeriodEndsAt: null,
    seatCount: 0,
    pendingSeatCount: null,
    disabledAt: null,
    purgeAfter: null,
    ...overrides,
  };
}

function makeClient(
  loadBilling: () => Promise<OrganizationBilling | null>,
  startTrial: () => Promise<OrganizationBilling | null> = () =>
    Promise.resolve(null),
) {
  return { organizations: { loadBilling, startTrial } };
}

test("only recovers a sync billing block in its organization scope", () => {
  expect(
    syncBillingBlockAppliesToOrganization(
      {
        isBlockedForOrganization: (organizationId) =>
          organizationId === "org-a",
      },
      "org-a",
    ),
  ).toBe(true);
  expect(
    syncBillingBlockAppliesToOrganization(
      {
        isBlockedForOrganization: (organizationId) =>
          organizationId === "org-a",
      },
      "org-b",
    ),
  ).toBe(false);
  expect(
    syncBillingBlockAppliesToOrganization(
      { isBlockedForOrganization: () => true },
      "org-b",
    ),
  ).toBe(true);
  expect(
    syncBillingBlockAppliesToOrganization(
      { isBlockedForOrganization: () => false },
      "org-b",
    ),
  ).toBe(false);
});

test("loads billing for the active org", async () => {
  const snapshot = billing({ status: "trialing" });
  const loadBilling = mock(() => Promise.resolve(snapshot));
  const client = makeClient(loadBilling);
  const { result } = renderHook(() =>
    useOrganizationBillingState(client, "org-1"),
  );

  await waitFor(() => expect(result.current.billing).toEqual(snapshot));
  expect(loadBilling).toHaveBeenCalledTimes(1);
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBe(null);
});

test("clears billing and resets loading/error when there is no active org", async () => {
  const loadBilling = mock(() => Promise.resolve(billing()));
  const client = makeClient(loadBilling);
  const { result } = renderHook(() =>
    useOrganizationBillingState(client, null),
  );

  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.billing).toBe(null);
  expect(result.current.error).toBe(null);
  expect(loadBilling).not.toHaveBeenCalled();
});

test("loads billing when authentication completes for the unchanged org", async () => {
  const snapshot = billing();
  const loadBilling = mock(() => Promise.resolve(snapshot));
  let billingBlockListener: (organizationId: string | null) => void = () => {};
  const subscribe = mock(
    (listener: (organizationId: string | null) => void) => {
      billingBlockListener = listener;
      return () => {};
    },
  );
  let isAuthenticated = false;
  const tearleads = {
    organizations: makeClient(loadBilling).organizations,
    syncBillingGate: {
      blockedOrganizationId: null,
      clearBlock: () => undefined,
      isBlocked: false,
      isBlockedForOrganization: () => false,
      subscribe,
    },
  } as unknown as ReturnType<typeof TearleadsProvider.useTearleads>;
  const cryptoSessionSpy = spyOn(
    CryptoSessionProvider,
    "useCryptoSession",
  ).mockImplementation(
    () =>
      ({
        isAuthenticated,
        organizationId: "org-1",
      }) as ReturnType<typeof CryptoSessionProvider.useCryptoSession>,
  );
  const tearleadsSpy = spyOn(
    TearleadsProvider,
    "useTearleads",
  ).mockImplementation(() => tearleads);

  try {
    const view = render(<BillingProvider>child</BillingProvider>);
    await act(async () => Promise.resolve());
    expect(loadBilling).not.toHaveBeenCalled();

    await act(async () => {
      billingBlockListener(null);
      await Promise.resolve();
    });
    expect(loadBilling).not.toHaveBeenCalled();

    isAuthenticated = true;
    view.rerender(<BillingProvider>child</BillingProvider>);

    await waitFor(() => expect(loadBilling).toHaveBeenCalledTimes(1));

    await act(async () => billingBlockListener(null));
    await waitFor(() => expect(loadBilling).toHaveBeenCalledTimes(2));
  } finally {
    cleanup();
    cryptoSessionSpy.mockRestore();
    tearleadsSpy.mockRestore();
  }
});

test("sets an error when the load returns null", async () => {
  const loadBilling = mock(() => Promise.resolve(null));
  const client = makeClient(loadBilling);
  const { result } = renderHook(() =>
    useOrganizationBillingState(client, "org-1"),
  );

  await waitFor(() => expect(result.current.error).not.toBe(null));
  expect(result.current.billing).toBe(null);
});

test("ignores a stale response when the active org changes mid-flight", async () => {
  const orgA = billing({ organizationId: "org-a", status: "trialing" });
  const orgB = billing({
    organizationId: "org-b",
    status: "active",
    trialEndsAt: null,
    currentPeriodEndsAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    provider: "revenuecat",
  });
  const resolvers: Array<(value: OrganizationBilling) => void> = [];
  const loadBilling = mock(
    () =>
      new Promise<OrganizationBilling>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  const client = makeClient(loadBilling);
  const { result, rerender } = renderHook(
    ({ orgId }: { orgId: string }) =>
      useOrganizationBillingState(client, orgId),
    { initialProps: { orgId: "org-a" } },
  );

  await waitFor(() => expect(loadBilling).toHaveBeenCalledTimes(1));
  await act(async () => {
    resolvers[0]?.(orgA);
  });
  await waitFor(() => expect(result.current.billing).toEqual(orgA));
  act(() => {
    void result.current.refresh();
  });
  await waitFor(() => expect(loadBilling).toHaveBeenCalledTimes(2));

  rerender({ orgId: "org-b" });
  expect(result.current.billing).toBe(null);
  expect(result.current.loading).toBe(true);
  expect(result.current.error).toBe(null);
  await waitFor(() => expect(loadBilling).toHaveBeenCalledTimes(3));

  // The old billing is hidden synchronously; only the matching org-b response
  // can populate the new scope, even when the second org-a request resolves
  // afterwards.
  await act(async () => {
    resolvers[2]?.(orgB);
    resolvers[1]?.(orgA);
  });

  expect(result.current.billing).toEqual(orgB);
});

test("rejects a billing response for a different organization", async () => {
  const wrongOrganization = billing({ organizationId: "org-a" });
  const client = makeClient(() => Promise.resolve(wrongOrganization));
  const { result } = renderHook(() =>
    useOrganizationBillingState(client, "org-b"),
  );

  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.billing).toBe(null);
  expect(result.current.error).not.toBe(null);
});

test("startTrial stores the returned billing and reports success", async () => {
  const local = billing({ status: "local", trialEndsAt: null });
  const started = billing({ status: "trialing" });
  const startTrial = mock(() => Promise.resolve(started));
  const client = makeClient(() => Promise.resolve(local), startTrial);
  const { result } = renderHook(() =>
    useOrganizationBillingState(client, "org-1"),
  );
  await waitFor(() => expect(result.current.billing).toEqual(local));

  let ok = false;
  await act(async () => {
    ok = await result.current.startTrial();
  });

  expect(ok).toBe(true);
  expect(result.current.billing).toEqual(started);
  expect(result.current.error).toBe(null);
});

test("commits a trial result after a newer billing read settles", async () => {
  const local = billing({ status: "local", trialEndsAt: null });
  const started = billing({ status: "trialing" });
  let resolveTrial: ((value: OrganizationBilling) => void) | null = null;
  const startTrial = mock(
    () =>
      new Promise<OrganizationBilling>((resolve) => {
        resolveTrial = resolve;
      }),
  );
  const client = makeClient(() => Promise.resolve(local), startTrial);
  const { result } = renderHook(() =>
    useOrganizationBillingState(client, "org-1"),
  );
  await waitFor(() => expect(result.current.billing).toEqual(local));

  let trialResult!: Promise<boolean>;
  act(() => {
    trialResult = result.current.startTrial();
  });
  await act(async () => {
    await result.current.refresh();
  });
  await act(async () => {
    resolveTrial?.(started);
  });
  const ok = await trialResult;

  expect(ok).toBe(true);
  expect(result.current.billing).toEqual(started);
});

test("a read started during trial activation cannot overwrite its result", async () => {
  const local = billing({ status: "local", trialEndsAt: null });
  const started = billing({ status: "trialing" });
  let loadCount = 0;
  let resolveRefresh: ((value: OrganizationBilling) => void) | null = null;
  let resolveTrial: ((value: OrganizationBilling) => void) | null = null;
  const loadBilling = mock(() => {
    loadCount++;
    if (loadCount === 1) {
      return Promise.resolve(local);
    }
    return new Promise<OrganizationBilling>((resolve) => {
      resolveRefresh = resolve;
    });
  });
  const startTrial = mock(
    () =>
      new Promise<OrganizationBilling>((resolve) => {
        resolveTrial = resolve;
      }),
  );
  const client = makeClient(loadBilling, startTrial);
  const { result } = renderHook(() =>
    useOrganizationBillingState(client, "org-1"),
  );
  await waitFor(() => expect(result.current.billing).toEqual(local));

  let trialResult!: Promise<boolean>;
  let refreshResult!: Promise<void>;
  act(() => {
    trialResult = result.current.startTrial();
    refreshResult = result.current.refresh();
  });
  await waitFor(() => expect(loadBilling).toHaveBeenCalledTimes(2));

  await act(async () => resolveTrial?.(started));
  expect(await trialResult).toBe(true);
  expect(result.current.billing).toEqual(started);

  await act(async () => resolveRefresh?.(local));
  await refreshResult;
  expect(result.current.billing).toEqual(started);
});

test("does not run an old organization's startTrial callback after a switch", async () => {
  const loadBilling = mock(() =>
    Promise.resolve(billing({ organizationId: "org-a", status: "local" })),
  );
  const startTrial = mock(() => Promise.resolve(billing()));
  const client = makeClient(loadBilling, startTrial);
  const { result, rerender } = renderHook(
    ({ orgId }: { orgId: string }) =>
      useOrganizationBillingState(client, orgId),
    { initialProps: { orgId: "org-a" } },
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  const oldStartTrial = result.current.startTrial;

  rerender({ orgId: "org-b" });

  let ok = true;
  await act(async () => {
    ok = await oldStartTrial();
  });

  expect(ok).toBe(false);
  expect(startTrial).not.toHaveBeenCalled();
});

test("startTrial reports failure and sets an error when it returns null", async () => {
  const local = billing({ status: "local", trialEndsAt: null });
  const client = makeClient(
    () => Promise.resolve(local),
    () => Promise.resolve(null),
  );
  const { result } = renderHook(() =>
    useOrganizationBillingState(client, "org-1"),
  );
  await waitFor(() => expect(result.current.billing).toEqual(local));

  let ok = true;
  await act(async () => {
    ok = await result.current.startTrial();
  });

  expect(ok).toBe(false);
  expect(result.current.error).not.toBe(null);
});
