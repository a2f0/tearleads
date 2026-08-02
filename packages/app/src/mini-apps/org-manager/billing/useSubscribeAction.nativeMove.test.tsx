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
): PurchasesCapability {
  return {
    identify: () => Promise.resolve(),
    isAvailable: true,
    nativeStore: "play_store",
    restore,
  } as never;
}

function setup(input: {
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
        purchases: purchases(input.restore),
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
  const flow = setup({
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
});
