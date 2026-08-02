import { afterEach, expect, mock, test } from "bun:test";
import type { PurchasesCapability } from "@tearleads/client-sdk";
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
