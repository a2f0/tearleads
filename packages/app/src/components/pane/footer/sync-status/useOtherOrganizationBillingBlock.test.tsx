import { afterEach, expect, test } from "bun:test";
import type { OrganizationBilling } from "@tearleads/client-sdk";
import { SyncBillingGate } from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useOtherOrganizationBillingBlocked } from "./useOtherOrganizationBillingBlock";

afterEach(cleanup);

const HOUR_MS = 60 * 60 * 1000;

function billing(
  organizationId: string,
  status: OrganizationBilling["status"],
  overrides: Partial<OrganizationBilling> = {},
): OrganizationBilling {
  return {
    organizationId,
    status,
    trialEndsAt: null,
    provider: null,
    currentPeriodStartsAt: null,
    currentPeriodEndsAt: null,
    seatCount: 1,
    disabledAt: null,
    purgeAfter: null,
    ...overrides,
  };
}

function renderBlocked(
  gate: SyncBillingGate,
  loadBilling: (organizationId: string) => Promise<OrganizationBilling | null>,
) {
  return renderHook(() =>
    useOtherOrganizationBillingBlocked({
      activeOrganizationId: "personal-org",
      gate,
      loadBilling,
    }),
  );
}

test("warns once a blocked organization resolves as lapsed", async () => {
  const gate = new SyncBillingGate();
  const { result } = renderBlocked(gate, async (organizationId) =>
    billing(organizationId, "disabled"),
  );
  expect(result.current).toBe(false);

  act(() => gate.notifyPaymentRequired("custom-org"));

  await waitFor(() => expect(result.current).toBe(true));
});

test("does not warn for a free local organization's 402", async () => {
  // The server 402s a `local` org exactly as it does a lapsed one, so the block
  // alone would raise a warning for an org that was never syncing.
  const gate = new SyncBillingGate();
  const { result } = renderBlocked(gate, async (organizationId) =>
    billing(organizationId, "local"),
  );

  act(() => gate.notifyPaymentRequired("custom-org"));

  await waitFor(() => expect(gate.isBlocked).toBe(true));
  expect(result.current).toBe(false);
});

test("ignores the active organization's own block", async () => {
  const gate = new SyncBillingGate();
  let reads = 0;
  const { result } = renderBlocked(gate, async (organizationId) => {
    reads += 1;
    return billing(organizationId, "disabled");
  });

  act(() => gate.notifyPaymentRequired("personal-org"));

  await waitFor(() => expect(gate.isBlocked).toBe(true));
  expect(result.current).toBe(false);
  // The shared billing snapshot already covers the active org; re-reading it
  // here would duplicate that request.
  expect(reads).toBe(0);
});

test("stops warning once the blocked organization recovers", async () => {
  const gate = new SyncBillingGate();
  const { result, rerender } = renderBlocked(gate, async (organizationId) =>
    billing(organizationId, "past_due"),
  );
  act(() => gate.notifyPaymentRequired("custom-org"));
  await waitFor(() => expect(result.current).toBe(true));

  // Recovery deliberately does not notify subscribers, so the cleared block is
  // observed on the next render rather than through the subscription.
  gate.clearBlock("custom-org");
  rerender();

  expect(result.current).toBe(false);
});

test("does not warn while a blocked organization's billing is unreadable", async () => {
  const gate = new SyncBillingGate();
  const { result } = renderBlocked(gate, async () => {
    throw new Error("403");
  });

  act(() => gate.notifyPaymentRequired("custom-org"));

  await waitFor(() => expect(gate.isBlocked).toBe(true));
  expect(result.current).toBe(false);
});

test("treats an expired trial on another organization as lapsed", async () => {
  const gate = new SyncBillingGate();
  const { result } = renderBlocked(gate, async (organizationId) =>
    billing(organizationId, "trialing", {
      trialEndsAt: new Date(Date.now() - HOUR_MS).toISOString(),
    }),
  );

  act(() => gate.notifyPaymentRequired("custom-org"));

  await waitFor(() => expect(result.current).toBe(true));
});

test("does not warn for another organization still inside its trial", async () => {
  const gate = new SyncBillingGate();
  const { result } = renderBlocked(gate, async (organizationId) =>
    billing(organizationId, "trialing", {
      trialEndsAt: new Date(Date.now() + HOUR_MS).toISOString(),
    }),
  );

  act(() => gate.notifyPaymentRequired("custom-org"));

  await waitFor(() => expect(gate.isBlocked).toBe(true));
  expect(result.current).toBe(false);
});
