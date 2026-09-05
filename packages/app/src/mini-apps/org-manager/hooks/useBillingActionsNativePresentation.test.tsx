import { afterEach, expect, mock, test } from "bun:test";
import type {
  PurchasesCapability,
  SyncPurchaseResult,
} from "@tearleads/client-sdk";
import { act, cleanup, waitFor } from "@testing-library/react";
import {
  createPurchases,
  OPTION,
  purchaseTraceEntries,
  renderBillingActions,
} from "../../../../test/helpers/billingActionsTestKit";

afterEach(cleanup);

test("a scope switch keeps a presented native purchase running", async () => {
  let resolvePurchase: ((value: SyncPurchaseResult) => void) | undefined;
  const purchaseSync = mock(
    (input: Parameters<PurchasesCapability["purchaseSync"]>[0]) =>
      new Promise<SyncPurchaseResult>((resolve) => {
        input.onProviderPresented?.();
        resolvePurchase = resolve;
      }),
  );
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    supportsEmbeddedCheckout: false,
    purchaseSync,
  };
  const { result, rerender } = renderBillingActions({ purchases });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(purchaseSync).toHaveBeenCalledTimes(1));
  rerender({
    billingIsActive: false,
    organizationId: "org-1",
    userId: "user-2",
  });
  await act(async () => Promise.resolve());
  expect(purchaseTraceEntries(result.current.logEntries)).not.toContainEqual({
    level: "info",
    message: "billing purchase stage=cancelled",
  });

  await act(async () => {
    resolvePurchase?.({ syncEntitlementActive: false });
  });
  expect(purchaseTraceEntries(result.current.logEntries)).toContainEqual({
    level: "info",
    message: "billing purchase stage=succeeded entitlement=inactive",
  });
});
