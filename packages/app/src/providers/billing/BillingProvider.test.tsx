import { afterEach, expect, mock, test } from "bun:test";
import type { OrganizationBilling } from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useOrganizationBillingState } from "./BillingProvider";

afterEach(() => cleanup());

const DAY_MS = 24 * 60 * 60 * 1000;

function billing(
  overrides: Partial<OrganizationBilling> = {},
): OrganizationBilling {
  return {
    organizationId: "org-1",
    status: "trialing",
    trialEndsAt: new Date(Date.now() + 3 * DAY_MS).toISOString(),
    provider: null,
    currentPeriodStartsAt: null,
    currentPeriodEndsAt: null,
    seatCount: 0,
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
  rerender({ orgId: "org-b" });
  await waitFor(() => expect(loadBilling).toHaveBeenCalledTimes(2));

  // Resolve the newer (org-b) request first, then the stale (org-a) one: the
  // stale late response must not clobber the fresh state.
  await act(async () => {
    resolvers[1]?.(orgB);
    resolvers[0]?.(orgA);
  });

  expect(result.current.billing).toEqual(orgB);
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

test("ignores a startTrial result superseded by a newer request", async () => {
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

  // Start a trial (its promise stays in flight)...
  let trialResult!: Promise<boolean>;
  act(() => {
    trialResult = result.current.startTrial();
  });
  // ...then a newer refresh bumps the request token, superseding the trial.
  await act(async () => {
    await result.current.refresh();
  });
  // Resolving the stale trial now must not commit its result.
  await act(async () => {
    resolveTrial?.(started);
  });
  const ok = await trialResult;

  expect(ok).toBe(false);
  expect(result.current.billing).toEqual(local);
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
