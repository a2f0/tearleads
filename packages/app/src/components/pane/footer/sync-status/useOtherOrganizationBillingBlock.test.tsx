import { afterEach, expect, test } from "bun:test";
import type { OrganizationBilling } from "@symcrypt/client-sdk";
import { SyncBillingGate } from "@symcrypt/client-sdk";
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
    activeMemberCount: 1,
    assignedSeatCount: 1,
    assignedUserIds: ["user-1"],
    currentUserHasSyncSeat: true,
    status,
    trialEndsAt: null,
    provider: null,
    currentPeriodStartsAt: null,
    currentPeriodEndsAt: null,
    seatCount: 1,
    pendingSeatCount: null,
    disabledAt: null,
    purgeAfter: null,
    ...overrides,
  };
}

function renderBlocked(
  gate: SyncBillingGate,
  loadBilling: (organizationId: string) => Promise<OrganizationBilling | null>,
  identityKey: string | null = "user-1",
) {
  return renderHook(
    (props: { identityKey: string | null }) =>
      useOtherOrganizationBillingBlocked({
        activeOrganizationId: "personal-org",
        gate,
        identityKey: props.identityKey,
        loadBilling,
      }),
    { initialProps: { identityKey } },
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
  rerender({ identityKey: "user-1" });

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

test("stops warning when the session ends", async () => {
  // The gate belongs to the SDK client and outlives a logout, so a signed-out
  // shell would otherwise keep warning from the previous identity's block —
  // and with no active org, every block counts as an outside one.
  const gate = new SyncBillingGate();
  const { result, rerender } = renderBlocked(gate, async (organizationId) =>
    billing(organizationId, "disabled"),
  );
  act(() => gate.notifyPaymentRequired("custom-org"));
  await waitFor(() => expect(result.current).toBe(true));

  rerender({ identityKey: null });

  expect(result.current).toBe(false);
});

test("re-resolves a carried-over block for the next identity", async () => {
  const gate = new SyncBillingGate();
  const statuses: OrganizationBilling["status"][] = ["disabled", "local"];
  const { result, rerender } = renderBlocked(gate, async (organizationId) =>
    billing(organizationId, statuses.shift() ?? "local"),
  );
  act(() => gate.notifyPaymentRequired("custom-org"));
  await waitFor(() => expect(result.current).toBe(true));

  // Same still-blocked org, new identity: the cached "lapsed" verdict belonged
  // to the previous session and must not carry over.
  rerender({ identityKey: "user-2" });

  await waitFor(() => expect(result.current).toBe(false));
});

test("reads each blocked organization's billing once", async () => {
  const gate = new SyncBillingGate();
  const reads: string[] = [];
  const { result } = renderBlocked(gate, async (organizationId) => {
    reads.push(organizationId);
    return billing(organizationId, "disabled");
  });

  act(() => gate.notifyPaymentRequired("custom-org-a"));
  await waitFor(() => expect(result.current).toBe(true));
  // A second organization's block re-runs the resolving effect; the first one
  // is already read and must not be requested again.
  act(() => gate.notifyPaymentRequired("custom-org-b"));
  await waitFor(() => expect(reads).toContain("custom-org-b"));

  expect(reads).toEqual(["custom-org-a", "custom-org-b"]);
});

test("re-reads an organization that was blocked, recovered, then blocked again", async () => {
  const gate = new SyncBillingGate();
  const reads: string[] = [];
  const { result, rerender } = renderBlocked(gate, async (organizationId) => {
    reads.push(organizationId);
    return billing(organizationId, "disabled");
  });
  act(() => gate.notifyPaymentRequired("custom-org"));
  await waitFor(() => expect(result.current).toBe(true));

  gate.clearBlock("custom-org");
  rerender({ identityKey: "user-1" });
  act(() => gate.notifyPaymentRequired("custom-org"));

  await waitFor(() => expect(reads).toEqual(["custom-org", "custom-org"]));
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
