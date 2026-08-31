import { afterEach, expect, test } from "bun:test";
import {
  PurchaseAbortedError,
  type PurchasesCapability,
  type SyncPurchaseResult,
} from "@symcrypt/client-sdk";
import { act, cleanup, waitFor } from "@testing-library/react";
import {
  createPurchases,
  OPTION,
  renderBillingActions,
} from "../../../../test/helpers/billingActionsTestKit";

afterEach(() => cleanup());

test("losing eligibility cancels a stalled native preflight", async () => {
  let resolveEligibility:
    | ((value: { eligible: true; reason: null }) => void)
    | undefined;
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    supportsEmbeddedCheckout: false,
  };
  const { result, rerender } = renderBillingActions({
    checkNativePurchaseEligibility: () =>
      new Promise((resolve) => {
        resolveEligibility = resolve;
      }),
    purchases,
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(result.current.checkoutActive).toBe(true));
  rerender({
    billingIsActive: false,
    isOrgAdmin: false,
    organizationId: "org-1",
    userId: "user-1",
  });

  await waitFor(() => expect(result.current.busy).toBe(null));
  await act(async () => {
    resolveEligibility?.({ eligible: true, reason: null });
  });
  expect(purchases.purchaseSync).not.toHaveBeenCalled();
});

test("losing eligibility aborts native preparation before the store sheet", async () => {
  let resolvePreparation: (() => void) | undefined;
  let presented = 0;
  const preparation = new Promise<void>((resolve) => {
    resolvePreparation = resolve;
  });
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    supportsEmbeddedCheckout: false,
    purchaseSync: async (input): Promise<SyncPurchaseResult> => {
      await preparation;
      if (input.abortSignal?.aborted) throw new PurchaseAbortedError();
      input.onProviderPresented?.();
      presented += 1;
      return { syncEntitlementActive: true };
    },
  };
  const { result, rerender } = renderBillingActions({ purchases });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(result.current.checkoutActive).toBe(true));
  rerender({
    billingIsActive: false,
    isOrgAdmin: false,
    organizationId: "org-1",
    userId: "user-1",
  });
  await waitFor(() => expect(result.current.busy).toBe(null));

  await act(async () => resolvePreparation?.());
  expect(presented).toBe(0);
});
