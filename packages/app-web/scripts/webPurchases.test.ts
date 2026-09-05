import { expect, test } from "bun:test";
import {
  type CustomerInfo,
  ErrorCode,
  PurchasesError,
  type Package as WebBillingPackage,
} from "@revenuecat/purchases-js";
import {
  PurchaseAbortedError,
  PurchaseCancelledError,
} from "@tearleads/client-sdk";
import {
  createWebRevenueCatBackend,
  type RevenueCatWebPurchases,
  type RevenueCatWebSdk,
} from "../src/webPurchases";

function customerInfo(activeEntitlementIds: readonly string[]): CustomerInfo {
  return {
    entitlements: {
      active: Object.fromEntries(
        activeEntitlementIds.map((id) => [id, { identifier: id }]),
      ),
    },
  } as unknown as CustomerInfo;
}

function packageWithProduct(input: {
  packageId: string;
  productId: string;
  title: string;
  description: string;
  priceLabel: string;
}): WebBillingPackage {
  return {
    identifier: input.packageId,
    webBillingProduct: {
      identifier: input.productId,
      title: input.title,
      description: input.description,
      price: { formattedPrice: input.priceLabel },
    },
  } as unknown as WebBillingPackage;
}

function createFakeSdk(options?: {
  purchaseError?: Error;
  purchaseNeverSettles?: boolean;
}) {
  const calls: string[] = [];
  const attributes: Record<string, string | null> = {};
  const purchaseInputs: Array<{
    htmlTarget?: HTMLElement;
    metadata?: Record<string, string>;
  }> = [];
  const monthlyPackage = packageWithProduct({
    packageId: "monthly",
    productId: "sync_solo_monthly",
    title: "Sync monthly",
    description: "Cloud sync",
    priceLabel: "$4.99",
  });
  const purchases: RevenueCatWebPurchases = {
    async changeUser(newAppUserId) {
      calls.push(`changeUser:${newAppUserId}`);
      return customerInfo([]);
    },
    async getCustomerInfo() {
      calls.push("getCustomerInfo");
      return customerInfo(["sync"]);
    },
    async getOfferings() {
      calls.push("getOfferings");
      return { current: { availablePackages: [monthlyPackage] } };
    },
    purchase({ rcPackage, htmlTarget, metadata }) {
      calls.push(`purchase:${rcPackage.identifier}`);
      purchaseInputs.push({
        ...(htmlTarget ? { htmlTarget } : {}),
        ...(metadata ? { metadata } : {}),
      });
      if (options?.purchaseNeverSettles) {
        // An embedded checkout waiting on the buyer: the SDK promise only
        // settles through its UI callbacks.
        return new Promise(() => undefined);
      }
      if (options?.purchaseError) {
        return Promise.reject(options.purchaseError);
      }
      return Promise.resolve({ customerInfo: customerInfo(["sync"]) });
    },
    async setAttributes(nextAttributes) {
      calls.push("setAttributes");
      Object.assign(attributes, nextAttributes);
    },
    close() {
      calls.push("close");
    },
  };
  const sdk: RevenueCatWebSdk = {
    configure(input) {
      calls.push(
        `configure:${input.apiKey}:${input.appUserId}:analytics=${String(input.flags.collectAnalyticsEvents)}`,
      );
      return purchases;
    },
    generateRevenueCatAnonymousAppUserId() {
      calls.push("anonymousId");
      return "$RCAnonymousID:test";
    },
  };
  return { attributes, calls, purchaseInputs, sdk };
}

test("web RevenueCat backend configures with the app user id and maps offerings", async () => {
  const { calls, sdk } = createFakeSdk();
  const backend = createWebRevenueCatBackend(sdk);

  await backend.configure({ apiKey: "web-key", appUserId: "user-1" });
  const packages = await backend.getCurrentPackages();

  expect(calls[0]).toBe("configure:web-key:user-1:analytics=false");
  expect(packages).toEqual([
    {
      identifier: "monthly",
      productIdentifier: "sync_solo_monthly",
      title: "Sync monthly",
      description: "Cloud sync",
      priceString: "$4.99",
    },
  ]);
});

test("web RevenueCat backend binds org attributes before purchase", async () => {
  const { attributes, calls, sdk } = createFakeSdk();
  const backend = createWebRevenueCatBackend(sdk);

  await backend.configure({ apiKey: "web-key", appUserId: "user-1" });
  await backend.setAttributes({ orgId: "org-1" });
  const result = await backend.purchasePackage({ packageId: "monthly" });

  expect(attributes).toEqual({ orgId: "org-1" });
  expect(result).toEqual({ activeEntitlementIds: ["sync"] });
  expect(calls.indexOf("setAttributes")).toBeLessThan(
    calls.indexOf("purchase:monthly"),
  );
});

test("web RevenueCat backend forwards embed target and metadata to the provider purchase", async () => {
  const { purchaseInputs, sdk } = createFakeSdk();
  const backend = createWebRevenueCatBackend(sdk);
  const htmlTarget = { id: "checkout-host" } as unknown as HTMLElement;

  await backend.configure({ apiKey: "web-key", appUserId: "user-1" });
  await backend.purchasePackage({
    packageId: "monthly",
    htmlTarget,
    metadata: { orgId: "org-1" },
  });
  await backend.purchasePackage({ packageId: "monthly" });

  expect(purchaseInputs).toEqual([
    { htmlTarget, metadata: { orgId: "org-1" } },
    {},
  ]);
});

test("abandoning a live purchase isolates it in a fresh SDK instance", async () => {
  const { calls, sdk } = createFakeSdk({ purchaseNeverSettles: true });
  const backend = createWebRevenueCatBackend(sdk);
  const controller = new AbortController();

  await backend.configure({ apiKey: "web-key", appUserId: "user-1" });
  void backend.purchasePackage({
    packageId: "monthly",
    abortSignal: controller.signal,
  });
  // Let the pre-purchase phase (offerings fetch) run so purchase() starts.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toContain("purchase:monthly");

  // The buyer dismisses the embedded checkout while the SDK purchase is still
  // live: the singleton must be closed and reconfigured (same buyer) so a
  // retried purchase cannot share checkout-session state with this one.
  controller.abort();

  expect(calls.indexOf("close")).toBeGreaterThan(-1);
  expect(calls.at(-1)).toBe("configure:web-key:user-1:analytics=false");
});

test("an abort after the purchase settled does not reset the SDK", async () => {
  const { calls, sdk } = createFakeSdk();
  const backend = createWebRevenueCatBackend(sdk);
  const controller = new AbortController();

  await backend.configure({ apiKey: "web-key", appUserId: "user-1" });
  await backend.purchasePackage({
    packageId: "monthly",
    abortSignal: controller.signal,
  });
  controller.abort();

  expect(calls).not.toContain("close");
});

test("a pre-mount failure of an abandoned purchase reads as cancellation", async () => {
  let rejectOfferings: ((error: Error) => void) | undefined;
  const { sdk } = createFakeSdk();
  const offeringsGate = new Promise<never>((_, reject) => {
    rejectOfferings = reject;
  });
  const gatedSdk: RevenueCatWebSdk = {
    ...sdk,
    configure(input) {
      const instance = sdk.configure(input);
      return {
        ...instance,
        getOfferings() {
          return offeringsGate;
        },
      };
    },
  };
  const backend = createWebRevenueCatBackend(gatedSdk);
  const controller = new AbortController();

  await backend.configure({ apiKey: "web-key", appUserId: "user-1" });
  const purchase = backend.purchasePackage({
    packageId: "monthly",
    abortSignal: controller.signal,
  });
  // The buyer cancels while the offerings fetch is in flight, then the fetch
  // fails: no checkout ever mounted, so the flow must settle as the
  // cancellation the abandonment asked for, not as a network failure.
  controller.abort();
  rejectOfferings?.(new Error("network down"));

  await expect(purchase).rejects.toBeInstanceOf(PurchaseCancelledError);
});

test("an aborted flow with a vanished package still reads as an abort", async () => {
  let resolveOfferings:
    | ((value: {
        current: { availablePackages: readonly WebBillingPackage[] } | null;
      }) => void)
    | undefined;
  const { sdk } = createFakeSdk();
  const gatedSdk: RevenueCatWebSdk = {
    ...sdk,
    configure(input) {
      const instance = sdk.configure(input);
      return {
        ...instance,
        getOfferings() {
          return new Promise((resolve) => {
            resolveOfferings = resolve;
          });
        },
      };
    },
  };
  const backend = createWebRevenueCatBackend(gatedSdk);
  const controller = new AbortController();

  await backend.configure({ apiKey: "web-key", appUserId: "user-1" });
  const purchase = backend.purchasePackage({
    packageId: "monthly",
    abortSignal: controller.signal,
  });
  // Cancelled mid-fetch, and the offering comes back without the package:
  // the abandonment must win over the unknown-package error.
  controller.abort();
  resolveOfferings?.({ current: { availablePackages: [] } });

  await expect(purchase).rejects.toBeInstanceOf(PurchaseAbortedError);
});

test("web RevenueCat backend refuses to mount a checkout for an aborted flow", async () => {
  const { calls, sdk } = createFakeSdk();
  const backend = createWebRevenueCatBackend(sdk);
  const controller = new AbortController();
  controller.abort();

  await backend.configure({ apiKey: "web-key", appUserId: "user-1" });
  await expect(
    backend.purchasePackage({
      packageId: "monthly",
      abortSignal: controller.signal,
    }),
  ).rejects.toBeInstanceOf(PurchaseCancelledError);

  // The purchase (and its checkout mount) must never have started.
  expect(calls.filter((call) => call.startsWith("purchase:"))).toEqual([]);
});

test("web RevenueCat backend maps a cancelled checkout to PurchaseCancelledError", async () => {
  const { sdk } = createFakeSdk({
    purchaseError: new PurchasesError(ErrorCode.UserCancelledError),
  });
  const backend = createWebRevenueCatBackend(sdk);

  await backend.configure({ apiKey: "web-key", appUserId: "user-1" });
  await expect(
    backend.purchasePackage({ packageId: "monthly" }),
  ).rejects.toBeInstanceOf(PurchaseCancelledError);
});

test("web RevenueCat backend rethrows non-cancel purchase errors unchanged", async () => {
  const providerError = new PurchasesError(
    ErrorCode.ProductNotAvailableForPurchaseError,
  );
  const { sdk } = createFakeSdk({ purchaseError: providerError });
  const backend = createWebRevenueCatBackend(sdk);

  await backend.configure({ apiKey: "web-key", appUserId: "user-1" });
  await expect(backend.purchasePackage({ packageId: "monthly" })).rejects.toBe(
    providerError,
  );
});

test("web RevenueCat backend can identify after anonymous configuration", async () => {
  const { calls, sdk } = createFakeSdk();
  const backend = createWebRevenueCatBackend(sdk);

  await backend.configure({ apiKey: "web-key" });
  await backend.logIn({ appUserId: "user-1" });
  await backend.logOut();

  expect(calls).toContain(
    "configure:web-key:$RCAnonymousID:test:analytics=false",
  );
  expect(calls).toContain("changeUser:user-1");
  expect(calls.at(-2)).toBe("anonymousId");
  expect(calls.at(-1)).toBe("changeUser:$RCAnonymousID:test");
});
