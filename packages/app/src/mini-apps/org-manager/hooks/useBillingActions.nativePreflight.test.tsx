import { afterEach, expect, test } from "bun:test";
import type { PurchasesCapability } from "@symcrypt/client-sdk";
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
