import { afterEach, expect, test } from "bun:test";
import { PurchasesUnavailableError } from "@tearleads/client-sdk";
import {
  createCapacitorPurchases,
  fixture,
  resetFixture,
  setEnv,
} from "../tests/capacitorPurchasesTestKit";

afterEach(resetFixture);

test("a missing purchase bridge blocks checkout but not entitlement reads", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.nativeConfigurationRejection = {
    code: "bridge-invalid",
    message: "RevenueCat purchase failed",
  };

  const purchases = createCapacitorPurchases();
  await purchases.identify({ userId: "user-1" });
  expect(await purchases.hasActiveSyncEntitlement()).toBe(true);
  expect(fixture.nativeConfigurationChecks).toBe(0);

  const error = await purchases
    .purchaseSync({ organizationId: "org-1", packageId: "monthly" })
    .then(
      () => null,
      (rejection: unknown) => rejection,
    );

  expect(fixture.configureCalls).toEqual([
    { apiKey: "ios-key", appUserID: "user-1" },
  ]);
  expect(fixture.nativeConfigurationChecks).toBe(1);
  expect(error).toBeInstanceOf(PurchasesUnavailableError);
  expect(error).toMatchObject({ code: "bridge-invalid" });
});
