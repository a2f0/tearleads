import { afterEach, expect, mock, spyOn, test } from "bun:test";
import {
  PurgedOrganizationRecoveryBillingRequiredError,
  type SessionRecoverOrganizationResult,
} from "@symcrypt/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { billingFixture } from "../../../../test/helpers/organizationBillingTestFixtures";
import { createAppHostConfig } from "../../../host/AppHostConfig";
import * as BillingProvider from "../../../providers/billing/BillingProvider";
import { DirectCheckoutProvider } from "../../../providers/direct-checkout/DirectCheckoutProvider";
import { AppHostConfigProvider } from "../../../providers/host/AppHostConfigProvider";
import * as IdentityProvider from "../../../providers/identity/IdentityProvider";
import { LogProvider } from "../../../providers/logging/LogProvider";
import { PurchasesProvider } from "../../../providers/purchases/PurchasesProvider";
import * as SymCryptProvider from "../../../providers/sdk/SymCryptProvider";
import { BillingPanel } from "../billing/BillingPanel";
import { ORG_MANAGER_LABELS } from "../labels";

const SOURCE_ORGANIZATION_ID = "purged-org";
const REPLACEMENT_CONTAINER_ID = "replacement-root";
const REPLACEMENT_ORGANIZATION_ID = "replacement-org";
const spies: { mockRestore: () => void }[] = [];

afterEach(() => {
  cleanup();
  while (spies.length > 0) spies.pop()?.mockRestore();
});

function billing(status: "active" | "local", organizationId: string) {
  const fixture = billingFixture(
    status === "active",
    status === "active",
    false,
  );
  return { ...fixture.billing, organizationId, status };
}

function stubSourceBilling() {
  const fixture = billingFixture(false, false, false);
  spies.push(
    spyOn(BillingProvider, "useOrganizationBilling").mockReturnValue({
      billing: {
        ...fixture.billing,
        organizationId: SOURCE_ORGANIZATION_ID,
        status: "purged",
      },
      error: null,
      loading: false,
      refresh: () => Promise.resolve(),
      startTrial: () => Promise.resolve(false),
      view: {
        ...fixture.view,
        isLocal: false,
        needsAttention: true,
        status: "purged",
      },
    }),
  );
}

function wrapperWithPurchases(
  purchaseSync: (input: {
    organizationId: string;
  }) => Promise<{ syncEntitlementActive: boolean }>,
) {
  return function Wrapper({ children }: PropsWithChildren) {
    const hostConfig = createAppHostConfig({
      apiBaseUrl: "http://localhost",
      createDirectCheckout: () => ({ isAvailable: false }) as never,
      createPurchases: () =>
        ({
          bindOrganization: () => Promise.resolve(),
          hasActiveSyncEntitlement: () => Promise.resolve(false),
          identify: () => Promise.resolve(),
          isAvailable: true,
          listSyncOptions: () =>
            Promise.resolve([
              {
                description: "Cloud sync",
                packageId: "monthly",
                priceLabel: "$4.99",
                productId: "sync_monthly",
                seatLimit: 1,
                tierId: "solo",
                title: "Sync",
              },
            ]),
          moveNativeSubscription: () => Promise.reject(new Error("unused")),
          nativeStore: null,
          purchaseSync,
          reset: () => Promise.resolve(),
          supportsEmbeddedCheckout: false,
        }) as never,
      wsUrl: "ws://localhost",
    });
    return (
      <AppHostConfigProvider value={hostConfig}>
        <PurchasesProvider>
          <LogProvider>
            <DirectCheckoutProvider>{children}</DirectCheckoutProvider>
          </LogProvider>
        </PurchasesProvider>
      </AppHostConfigProvider>
    );
  };
}

test("bills the durable replacement and resumes purge recovery after payment", async () => {
  stubSourceBilling();
  let replacementStatus: "active" | "local" = "local";
  const recovered: SessionRecoverOrganizationResult = {
    containerId: REPLACEMENT_CONTAINER_ID,
    organizationId: REPLACEMENT_ORGANIZATION_ID,
    replacedOrganizationId: SOURCE_ORGANIZATION_ID,
    reset: { clearedOrganizationId: SOURCE_ORGANIZATION_ID } as never,
  };
  const recoverPurgedOrganization = mock(async (_organizationId: string) => {
    if (replacementStatus === "local") {
      throw new PurgedOrganizationRecoveryBillingRequiredError(
        REPLACEMENT_ORGANIZATION_ID,
        "local",
        REPLACEMENT_CONTAINER_ID,
      );
    }
    return recovered;
  });
  const loadBillingForOrganization = mock((organizationId: string) =>
    Promise.resolve(billing(replacementStatus, organizationId)),
  );
  const persistSession = mock(() => Promise.resolve(true));
  const purchaseSync = mock(async (_input: { organizationId: string }) => {
    replacementStatus = "active";
    return { syncEntitlementActive: true };
  });
  spies.push(
    spyOn(IdentityProvider, "useIdentity").mockReturnValue({
      persistSession,
    } as unknown as ReturnType<typeof IdentityProvider.useIdentity>),
    spyOn(SymCryptProvider, "useSymCrypt").mockReturnValue({
      organizations: {
        checkNativePurchaseEligibility: () => Promise.resolve(null),
        claimNativeSubscription: () => Promise.resolve(null),
        loadBillingForOrganization,
        loadBillingManagementUrl: () => Promise.resolve(null),
        loadStripeCheckoutOptions: () => Promise.resolve({ options: [] }),
        startTrial: () => Promise.resolve(null),
      },
      session: { recoverPurgedOrganization },
    } as never),
  );

  const view = render(
    <BillingPanel
      isOrgAdmin
      isPersonalOrganization
      organizationId={SOURCE_ORGANIZATION_ID}
      userId="user-1"
    />,
    { wrapper: wrapperWithPurchases(purchaseSync) },
  );

  await view.findByText(ORG_MANAGER_LABELS.purgeRecoveryBillingRequired);
  fireEvent.click(
    await view.findByRole("button", {
      name: ORG_MANAGER_LABELS.billingSubscribe,
    }),
  );

  await waitFor(() =>
    expect(recoverPurgedOrganization).toHaveBeenCalledTimes(2),
  );
  expect(recoverPurgedOrganization.mock.calls[0]?.[0]).toBe(
    SOURCE_ORGANIZATION_ID,
  );
  expect(recoverPurgedOrganization.mock.calls[1]?.[0]).toBe(
    SOURCE_ORGANIZATION_ID,
  );
  expect(purchaseSync.mock.calls[0]?.[0].organizationId).toBe(
    REPLACEMENT_ORGANIZATION_ID,
  );
  expect(
    loadBillingForOrganization.mock.calls.every(
      ([organizationId]) => organizationId === REPLACEMENT_ORGANIZATION_ID,
    ),
  ).toBe(true);
  expect(persistSession).toHaveBeenCalledTimes(1);
});

test("surfaces and retries a finalized recovery whose session was not persisted", async () => {
  stubSourceBilling();
  const recovered: SessionRecoverOrganizationResult = {
    containerId: REPLACEMENT_CONTAINER_ID,
    organizationId: REPLACEMENT_ORGANIZATION_ID,
    replacedOrganizationId: SOURCE_ORGANIZATION_ID,
    reset: { clearedOrganizationId: SOURCE_ORGANIZATION_ID } as never,
  };
  const recoverPurgedOrganization = mock(() => Promise.resolve(recovered));
  let persistenceAttempt = 0;
  const persistSession = mock(() => {
    persistenceAttempt += 1;
    return Promise.resolve(persistenceAttempt > 1);
  });
  spies.push(
    spyOn(IdentityProvider, "useIdentity").mockReturnValue({
      persistSession,
    } as unknown as ReturnType<typeof IdentityProvider.useIdentity>),
    spyOn(SymCryptProvider, "useSymCrypt").mockReturnValue({
      organizations: {
        checkNativePurchaseEligibility: () => Promise.resolve(null),
        claimNativeSubscription: () => Promise.resolve(null),
        loadBillingForOrganization: () => Promise.resolve(null),
        loadBillingManagementUrl: () => Promise.resolve(null),
        loadStripeCheckoutOptions: () => Promise.resolve({ options: [] }),
        startTrial: () => Promise.resolve(null),
      },
      session: { recoverPurgedOrganization },
    } as never),
  );

  const view = render(
    <BillingPanel
      isOrgAdmin
      isPersonalOrganization
      organizationId={SOURCE_ORGANIZATION_ID}
      userId="user-1"
    />,
    { wrapper: wrapperWithPurchases(() => new Promise(() => undefined)) },
  );

  await view.findByText(ORG_MANAGER_LABELS.purgeRecoveryFailed);
  expect(recoverPurgedOrganization).toHaveBeenCalledTimes(1);
  expect(persistSession).toHaveBeenCalledTimes(1);

  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.refresh }),
  );
  await waitFor(() => expect(persistSession).toHaveBeenCalledTimes(2));
  expect(recoverPurgedOrganization).toHaveBeenCalledTimes(2);
  expect(view.queryByText(ORG_MANAGER_LABELS.purgeRecoveryFailed)).toBeNull();
});

test("reopens the same durable replacement after the panel remounts", async () => {
  stubSourceBilling();
  const recoverPurgedOrganization = mock((_organizationId: string) =>
    Promise.reject(
      new PurgedOrganizationRecoveryBillingRequiredError(
        REPLACEMENT_ORGANIZATION_ID,
        "local",
        REPLACEMENT_CONTAINER_ID,
      ),
    ),
  );
  const loadBillingForOrganization = mock((organizationId: string) =>
    Promise.resolve(billing("local", organizationId)),
  );
  spies.push(
    spyOn(IdentityProvider, "useIdentity").mockReturnValue({
      persistSession: () => Promise.resolve(true),
    } as unknown as ReturnType<typeof IdentityProvider.useIdentity>),
    spyOn(SymCryptProvider, "useSymCrypt").mockReturnValue({
      organizations: {
        checkNativePurchaseEligibility: () => Promise.resolve(null),
        claimNativeSubscription: () => Promise.resolve(null),
        loadBillingForOrganization,
        loadBillingManagementUrl: () => Promise.resolve(null),
        loadStripeCheckoutOptions: () => Promise.resolve({ options: [] }),
        startTrial: () => Promise.resolve(null),
      },
      session: { recoverPurgedOrganization },
    } as never),
  );
  const wrapper = wrapperWithPurchases(() => new Promise(() => undefined));
  const first = render(
    <BillingPanel
      isOrgAdmin
      isPersonalOrganization
      organizationId={SOURCE_ORGANIZATION_ID}
      userId="user-1"
    />,
    { wrapper },
  );
  await first.findByText(ORG_MANAGER_LABELS.purgeRecoveryBillingRequired);
  first.unmount();

  const second = render(
    <BillingPanel
      isOrgAdmin
      isPersonalOrganization
      organizationId={SOURCE_ORGANIZATION_ID}
      userId="user-1"
    />,
    { wrapper },
  );
  await second.findByText(ORG_MANAGER_LABELS.purgeRecoveryBillingRequired);

  expect(recoverPurgedOrganization).toHaveBeenCalledTimes(2);
  expect(
    recoverPurgedOrganization.mock.calls.every(
      ([organizationId]) => organizationId === SOURCE_ORGANIZATION_ID,
    ),
  ).toBe(true);
});

test("an identity change cannot publish the previous identity's replacement", async () => {
  stubSourceBilling();
  const rejectAttempts: Array<(error: Error) => void> = [];
  const recoverPurgedOrganization = mock(
    (_organizationId: string) =>
      new Promise<SessionRecoverOrganizationResult | null>((_resolve, reject) =>
        rejectAttempts.push(reject),
      ),
  );
  const loadBillingForOrganization = mock((organizationId: string) =>
    Promise.resolve(billing("local", organizationId)),
  );
  spies.push(
    spyOn(IdentityProvider, "useIdentity").mockReturnValue({
      persistSession: () => Promise.resolve(true),
    } as unknown as ReturnType<typeof IdentityProvider.useIdentity>),
    spyOn(SymCryptProvider, "useSymCrypt").mockReturnValue({
      organizations: {
        checkNativePurchaseEligibility: () => Promise.resolve(null),
        claimNativeSubscription: () => Promise.resolve(null),
        loadBillingForOrganization,
        loadBillingManagementUrl: () => Promise.resolve(null),
        loadStripeCheckoutOptions: () => Promise.resolve({ options: [] }),
        startTrial: () => Promise.resolve(null),
      },
      session: { recoverPurgedOrganization },
    } as never),
  );
  const wrapper = wrapperWithPurchases(() => new Promise(() => undefined));
  const view = render(
    <BillingPanel
      isOrgAdmin
      isPersonalOrganization
      organizationId={SOURCE_ORGANIZATION_ID}
      userId="user-1"
    />,
    { wrapper },
  );
  await waitFor(() =>
    expect(recoverPurgedOrganization).toHaveBeenCalledTimes(1),
  );

  view.rerender(
    <BillingPanel
      isOrgAdmin
      isPersonalOrganization
      organizationId={SOURCE_ORGANIZATION_ID}
      userId="user-2"
    />,
  );
  await waitFor(() =>
    expect(recoverPurgedOrganization).toHaveBeenCalledTimes(2),
  );
  await act(async () => {
    rejectAttempts[0]?.(
      new PurgedOrganizationRecoveryBillingRequiredError(
        "stale-replacement",
        "local",
        "stale-root",
      ),
    );
    rejectAttempts[1]?.(
      new PurgedOrganizationRecoveryBillingRequiredError(
        REPLACEMENT_ORGANIZATION_ID,
        "local",
        REPLACEMENT_CONTAINER_ID,
      ),
    );
  });

  await view.findByText(ORG_MANAGER_LABELS.purgeRecoveryBillingRequired);
  expect(loadBillingForOrganization.mock.calls).toEqual([
    [REPLACEMENT_ORGANIZATION_ID],
  ]);
});
