import { expect, test } from "bun:test";
import {
  type CustomerInfo,
  ErrorCode,
  PurchasesError,
  type Package as WebBillingPackage,
} from "@revenuecat/purchases-js";
import { PurchaseCancelledError } from "@tearleads/client-sdk";
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

function createFakeSdk(options?: { purchaseError?: Error }) {
  const calls: string[] = [];
  const attributes: Record<string, string | null> = {};
  const purchaseHtmlTargets: Array<HTMLElement | undefined> = [];
  const monthlyPackage = packageWithProduct({
    packageId: "monthly",
    productId: "sync_monthly",
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
    async purchase({ rcPackage, htmlTarget }) {
      calls.push(`purchase:${rcPackage.identifier}`);
      purchaseHtmlTargets.push(htmlTarget);
      if (options?.purchaseError) {
        throw options.purchaseError;
      }
      return { customerInfo: customerInfo(["sync"]) };
    },
    async setAttributes(nextAttributes) {
      calls.push("setAttributes");
      Object.assign(attributes, nextAttributes);
    },
  };
  const sdk: RevenueCatWebSdk = {
    configure(input) {
      calls.push(`configure:${input.apiKey}:${input.appUserId}`);
      return purchases;
    },
    generateRevenueCatAnonymousAppUserId() {
      calls.push("anonymousId");
      return "$RCAnonymousID:test";
    },
  };
  return { attributes, calls, purchaseHtmlTargets, sdk };
}

test("web RevenueCat backend configures with the app user id and maps offerings", async () => {
  const { calls, sdk } = createFakeSdk();
  const backend = createWebRevenueCatBackend(sdk);

  await backend.configure({ apiKey: "web-key", appUserId: "user-1" });
  const packages = await backend.getCurrentPackages();

  expect(calls[0]).toBe("configure:web-key:user-1");
  expect(packages).toEqual([
    {
      identifier: "monthly",
      productIdentifier: "sync_monthly",
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

test("web RevenueCat backend forwards the embed target to the provider purchase", async () => {
  const { purchaseHtmlTargets, sdk } = createFakeSdk();
  const backend = createWebRevenueCatBackend(sdk);
  const htmlTarget = { id: "checkout-host" } as unknown as HTMLElement;

  await backend.configure({ apiKey: "web-key", appUserId: "user-1" });
  await backend.purchasePackage({ packageId: "monthly", htmlTarget });
  await backend.purchasePackage({ packageId: "monthly" });

  expect(purchaseHtmlTargets).toEqual([htmlTarget, undefined]);
});

test("web RevenueCat backend maps a cancelled checkout to PurchaseCancelledError", async () => {
  const { sdk } = createFakeSdk({
    purchaseError: new PurchasesError(ErrorCode.UserCancelledError),
  });
  const backend = createWebRevenueCatBackend(sdk);

  await backend.configure({ apiKey: "web-key", appUserId: "user-1" });
  expect(
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
  expect(backend.purchasePackage({ packageId: "monthly" })).rejects.toBe(
    providerError,
  );
});

test("web RevenueCat backend can identify after anonymous configuration", async () => {
  const { calls, sdk } = createFakeSdk();
  const backend = createWebRevenueCatBackend(sdk);

  await backend.configure({ apiKey: "web-key" });
  await backend.logIn({ appUserId: "user-1" });
  await backend.logOut();

  expect(calls).toContain("configure:web-key:$RCAnonymousID:test");
  expect(calls).toContain("changeUser:user-1");
  expect(calls.at(-2)).toBe("anonymousId");
  expect(calls.at(-1)).toBe("changeUser:$RCAnonymousID:test");
});
