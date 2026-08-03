import { afterEach, expect, mock, test } from "bun:test";
import {
  PurchaseIdentityPendingError,
  PurchaseProviderStalledError,
  type PurchasesCapability,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { LogProvider } from "../../../providers/logging/LogProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import {
  type BillingActionScope,
  type BillingActionState,
  emptyActionState,
  type UpdateActionState,
} from "./billingActionScope";
import { useNativeSubscriptionMove } from "./useSubscribeAction";

const SCOPE: BillingActionScope = {
  generation: 1,
  organizationId: "org-1",
  userId: "user-1",
};

afterEach(cleanup);

function purchases(
  restore: PurchasesCapability["restore"],
  bindOrganization: PurchasesCapability["bindOrganization"] = () =>
    Promise.resolve(),
): PurchasesCapability {
  return {
    bindOrganization,
    identify: () => Promise.resolve(),
    isAvailable: true,
    async moveNativeSubscription(
      input: Parameters<PurchasesCapability["moveNativeSubscription"]>[0],
    ) {
      const restored = await restore();
      if (!restored.syncEntitlementActive) {
        throw new Error("The restored receipt has no sync entitlement");
      }
      if (!(await input.claim("play_store"))) {
        throw new Error("The server did not accept the native subscription");
      }
      await bindOrganization({ organizationId: input.organizationId });
    },
    nativeStore: "play_store",
    restore,
  } as never;
}

function setup(input: {
  readonly bindOrganization?: PurchasesCapability["bindOrganization"];
  readonly claim: () => Promise<boolean>;
  readonly restore: PurchasesCapability["restore"];
}) {
  let state: BillingActionState = emptyActionState(SCOPE);
  const updateActionState: UpdateActionState = (_scope, update) => {
    state = update(state);
  };
  const view = renderHook(
    () =>
      useNativeSubscriptionMove({
        claimNativeSubscription: input.claim,
        currentScope: SCOPE,
        purchases: purchases(input.restore, input.bindOrganization),
        refresh: () => Promise.resolve(),
        scopeRef: { current: SCOPE },
        updateActionState,
        userId: SCOPE.userId,
      }),
    {
      wrapper: ({ children }: PropsWithChildren) => (
        <LogProvider>{children}</LogProvider>
      ),
    },
  );
  return { state: () => state, view };
}

function startMove(view: ReturnType<typeof setup>["view"]): void {
  act(() => view.result.current.request());
  act(() => view.result.current.confirm());
}

test("restore stays busy and rejects a receipt without sync", async () => {
  const flow = setup({
    claim: () => Promise.resolve(true),
    restore: () => Promise.resolve({ syncEntitlementActive: false }),
  });
  startMove(flow.view);
  expect(flow.state().busy).toBe("restore");
  expect(flow.view.result.current.open).toBe(true);

  await waitFor(() =>
    expect(flow.state().actionError).toBe(
      ORG_MANAGER_LABELS.failedRestorePurchases,
    ),
  );
  expect(flow.view.result.current.open).toBe(false);
});

test("restore asks the buyer to retry while identity is settling", async () => {
  const flow = setup({
    claim: () => Promise.resolve(true),
    restore: () => Promise.reject(new PurchaseIdentityPendingError()),
  });
  startMove(flow.view);

  await waitFor(() =>
    expect(flow.state().actionError).toBe(
      ORG_MANAGER_LABELS.billingIdentityPending,
    ),
  );
});

test("restore asks for restart when the provider bridge stalls", async () => {
  const flow = setup({
    claim: () => Promise.resolve(true),
    restore: () => Promise.reject(new PurchaseProviderStalledError()),
  });
  startMove(flow.view);

  await waitFor(() =>
    expect(flow.state().actionError).toBe(
      ORG_MANAGER_LABELS.billingProviderStalled,
    ),
  );
});

test("restore surfaces a server-side claim rejection", async () => {
  const claim = mock(() => Promise.resolve(false));
  const bindOrganization = mock(() => Promise.resolve());
  const flow = setup({
    bindOrganization,
    claim,
    restore: () => Promise.resolve({ syncEntitlementActive: true }),
  });
  startMove(flow.view);

  await waitFor(() =>
    expect(flow.state().actionError).toBe(
      ORG_MANAGER_LABELS.failedRestorePurchases,
    ),
  );
  expect(claim).toHaveBeenCalledWith("play_store");
  expect(bindOrganization).not.toHaveBeenCalled();
});

test("restore binds lifecycle attribution only after the claim succeeds", async () => {
  const calls: string[] = [];
  const flow = setup({
    bindOrganization: () => {
      calls.push("bind");
      return Promise.resolve();
    },
    claim: () => {
      calls.push("claim");
      return Promise.resolve(true);
    },
    restore: () => {
      calls.push("restore");
      return Promise.resolve({ syncEntitlementActive: true });
    },
  });
  startMove(flow.view);

  await waitFor(() => expect(flow.state().busy).toBeNull());
  expect(calls).toEqual(["restore", "claim", "bind"]);
});

test("a binding failure can retry the idempotent native move", async () => {
  const claim = mock(() => Promise.resolve(true));
  const restore = mock(() => Promise.resolve({ syncEntitlementActive: true }));
  let bindAttempts = 0;
  const bindOrganization = mock(() => {
    bindAttempts += 1;
    return bindAttempts === 1
      ? Promise.reject(new PurchaseProviderStalledError())
      : Promise.resolve();
  });
  const flow = setup({ bindOrganization, claim, restore });
  startMove(flow.view);
  await waitFor(() =>
    expect(flow.state().actionError).toBe(
      ORG_MANAGER_LABELS.billingProviderStalled,
    ),
  );

  startMove(flow.view);
  await waitFor(() => expect(flow.state().busy).toBeNull());

  expect(restore).toHaveBeenCalledTimes(2);
  expect(claim).toHaveBeenCalledTimes(2);
  expect(bindOrganization).toHaveBeenCalledTimes(2);
  expect(flow.state().actionError).toBeNull();
});

test("a panel remount preserves native move binding order", async () => {
  const nextScope: BillingActionScope = {
    generation: 2,
    organizationId: "org-2",
    userId: "user-1",
  };
  let finishFirstClaim = (_accepted: boolean) => {};
  const firstClaim = new Promise<boolean>((resolve) => {
    finishFirstClaim = resolve;
  });
  let claimAttempts = 0;
  const claim = mock(() => {
    claimAttempts += 1;
    return claimAttempts === 1 ? firstClaim : Promise.resolve(true);
  });
  const bindOrganization = mock(() => Promise.resolve());
  const scopeRef = { current: SCOPE };
  const updateActionState: UpdateActionState = () => {};
  const capability = purchases(
    () => Promise.resolve({ syncEntitlementActive: true }),
    bindOrganization,
  );
  const firstView = renderHook(
    () =>
      useNativeSubscriptionMove({
        claimNativeSubscription: claim,
        currentScope: SCOPE,
        purchases: capability,
        refresh: () => Promise.resolve(),
        scopeRef,
        updateActionState,
        userId: SCOPE.userId,
      }),
    {
      wrapper: ({ children }: PropsWithChildren) => (
        <LogProvider>{children}</LogProvider>
      ),
    },
  );

  act(() => firstView.result.current.request());
  act(() => firstView.result.current.confirm());
  await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
  firstView.unmount();

  scopeRef.current = nextScope;
  const secondView = renderHook(
    () =>
      useNativeSubscriptionMove({
        claimNativeSubscription: claim,
        currentScope: nextScope,
        purchases: capability,
        refresh: () => Promise.resolve(),
        scopeRef,
        updateActionState,
        userId: nextScope.userId,
      }),
    {
      wrapper: ({ children }: PropsWithChildren) => (
        <LogProvider>{children}</LogProvider>
      ),
    },
  );
  act(() => secondView.result.current.request());
  act(() => secondView.result.current.confirm());
  await act(() => Promise.resolve());
  expect(claim).toHaveBeenCalledTimes(1);
  expect(bindOrganization).not.toHaveBeenCalled();

  finishFirstClaim(true);
  await waitFor(() => expect(bindOrganization).toHaveBeenCalledTimes(2));
  expect(bindOrganization).toHaveBeenNthCalledWith(1, {
    organizationId: "org-1",
  });
  expect(bindOrganization).toHaveBeenNthCalledWith(2, {
    organizationId: "org-2",
  });
});

test.each([
  [404, ORG_MANAGER_LABELS.nativeClaimNotFound],
  [409, ORG_MANAGER_LABELS.nativeClaimConflict],
  [503, ORG_MANAGER_LABELS.nativeClaimPending],
] as const)("restore surfaces an actionable %s claim failure", async (status, label) => {
  const flow = setup({
    claim: () =>
      Promise.reject(Object.assign(new Error("claim rejected"), { status })),
    restore: () => Promise.resolve({ syncEntitlementActive: true }),
  });
  startMove(flow.view);

  await waitFor(() => expect(flow.state().actionError).toBe(label));
});
