import { afterEach, expect, mock, test } from "bun:test";
import type {
  PurchasesCapability,
  SyncPurchaseResult,
} from "@tearleads/client-sdk";
import { act, cleanup, waitFor } from "@testing-library/react";
import {
  createPurchases,
  OPTION,
  renderBillingActions,
} from "../../../../test/helpers/billingActionsTestKit";

afterEach(() => cleanup());

test("a scope switch aborts native preparation before layout can present it", async () => {
  let purchaseInput:
    | {
        abortSignal?: AbortSignal;
        onProviderPresented?: () => void;
      }
    | undefined;
  let providerPresented = false;
  const purchaseSync = mock((input: NonNullable<typeof purchaseInput>) => {
    purchaseInput = input;
    return new Promise<SyncPurchaseResult>(() => undefined);
  });
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    supportsEmbeddedCheckout: false,
    purchaseSync: purchaseSync as PurchasesCapability["purchaseSync"],
  };
  const { result, rerender } = renderBillingActions({
    observeLayout: () => {
      if (purchaseInput && !purchaseInput.abortSignal?.aborted) {
        purchaseInput.onProviderPresented?.();
        providerPresented = true;
      }
    },
    purchases,
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(purchaseInput).toBeDefined());
  rerender({
    billingIsActive: false,
    organizationId: "org-1",
    userId: "user-2",
  });

  expect(purchaseInput?.abortSignal?.aborted).toBe(true);
  expect(providerPresented).toBe(false);
  await waitFor(() => expect(result.current.busy).toBe(null));
});
