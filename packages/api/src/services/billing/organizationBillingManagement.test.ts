import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { registerAndAuthenticate } from "../../../test/helpers/revenuecatWebhook";
import { getDefaultApiServiceRuntime } from "../runtime";
import { getOrganizationBillingManagementUrl } from "./organizationBilling";

test("a promotional grant retains its RevenueCat management path", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: admin.userId,
      providerProductId: "promotional:sync_team_5_monthly",
      providerSubscriptionId: "promo-sub-1",
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, organizationId));

  const result = await getOrganizationBillingManagementUrl(
    getDefaultApiServiceRuntime(),
    organizationId,
    admin.userId,
    {
      revenueCat: {
        env: {
          REVENUECAT_PROJECT_ID: "proj_test",
          REVENUECAT_V2_SECRET_KEY: "sk_test",
        },
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({
              items: [
                {
                  gives_access: true,
                  management_url: "https://provider.example/manage",
                  store_subscription_identifier: "promo-sub-1",
                },
              ],
            }),
          )) as unknown as typeof fetch,
      },
    },
  );

  expect(result).toEqual({
    canCancelDirectly: false,
    managementUrl: "https://provider.example/manage",
    subscriptionSource: "native",
  });
});
