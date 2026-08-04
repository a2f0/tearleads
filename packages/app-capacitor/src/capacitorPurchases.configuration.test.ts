import { afterEach, expect, test } from "bun:test";
import {
  createCapacitorPurchases,
  fixture,
  resetFixture,
  setEnv,
} from "../tests/capacitorPurchasesTestKit";

afterEach(resetFixture);

test("fails configuration when the native purchase bridge sees no singleton", async () => {
  setEnv("VITE_REVENUECAT_IOS_API_KEY", "ios-key");
  fixture.nativeConfigurationRejection = {
    code: "bridge-invalid",
    message: "RevenueCat purchase failed",
  };

  const error = await createCapacitorPurchases()
    .identify({ userId: "user-1" })
    .then(
      () => null,
      (rejection: unknown) => rejection,
    );

  expect(fixture.configureCalls).toEqual([
    { apiKey: "ios-key", appUserID: "user-1" },
  ]);
  expect(fixture.nativeConfigurationChecks).toBe(1);
  expect(error).toMatchObject({ code: "bridge-invalid" });
});
