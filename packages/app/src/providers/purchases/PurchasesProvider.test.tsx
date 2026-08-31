import { expect, test } from "bun:test";
import type { PurchasesCapability } from "@symcrypt/client-sdk";
import { render } from "@testing-library/react";
import {
  type CreatePurchasesFn,
  createAppHostConfig,
} from "../../host/AppHostConfig";
import { AppHostConfigProvider } from "../host/AppHostConfigProvider";
import { PurchasesProvider, usePurchases } from "./PurchasesProvider";

const availableCapability: PurchasesCapability = {
  bindOrganization: () => Promise.resolve(),
  isAvailable: true,
  nativeStore: "test_store",
  identify: () => Promise.resolve(),
  reset: () => Promise.resolve(),
  listSyncOptions: () => Promise.resolve([]),
  moveNativeSubscription: () =>
    Promise.resolve({ organizationId: "restored-org" }),
  purchaseSync: () => Promise.resolve({ syncEntitlementActive: false }),
  hasActiveSyncEntitlement: () => Promise.resolve(false),
};

function Harness() {
  const purchases = usePurchases();
  return <div data-testid="available">{String(purchases.isAvailable)}</div>;
}

function renderWithHostConfig(createPurchases?: CreatePurchasesFn) {
  const hostConfig = createAppHostConfig({
    apiBaseUrl: "http://localhost",
    wsUrl: "ws://localhost",
    ...(createPurchases ? { createPurchases } : {}),
  });
  return render(
    <AppHostConfigProvider value={hostConfig}>
      <PurchasesProvider>
        <Harness />
      </PurchasesProvider>
    </AppHostConfigProvider>,
  );
}

test("falls back to the unavailable stub when no capability is injected", () => {
  const view = renderWithHostConfig();
  expect(view.getByTestId("available").textContent).toBe("false");
  view.unmount();
});

test("exposes the injected purchases capability and memoizes the factory", () => {
  let created = 0;
  const view = renderWithHostConfig(() => {
    created += 1;
    return availableCapability;
  });
  expect(view.getByTestId("available").textContent).toBe("true");
  expect(created).toBe(1);
  view.unmount();
});
