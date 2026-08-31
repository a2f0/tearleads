import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { organizationBilling, users } from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { createOrganizationRequestBody } from "../../../test/helpers/api";
import { registerUser } from "../../../test/helpers/registerUser";
import { runCreateOrganizationWorkflow } from "../../workflows/organizations/createOrganization";
import { getDefaultApiServiceRuntime } from "../runtime";
import { processRevenueCatWebhook } from "./revenuecatWebhook";

const ENV = {
  REVENUECAT_ALLOW_SANDBOX_EVENTS: "true",
  REVENUECAT_PROJECT_ID: "proj_1",
  REVENUECAT_V2_SECRET_KEY: "sk_test",
} as NodeJS.ProcessEnv;

test("a store-specific transfer selects its exact binding for a multi-store buyer", async () => {
  const user = createTestUser();
  const appleSubscriptionId = `apple-${crypto.randomUUID()}`;
  const playSubscriptionId = `GPA.play-${crypto.randomUUID()}`;
  await registerUser(user);
  const [registered] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(registered, "expected registered user");
  const request = await createOrganizationRequestBody(user);
  const restored = await runCreateOrganizationWorkflow(db, request);

  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: user.userId,
      providerProductId: "com.symcrypt.sync.monthly",
      providerSubscriptionId: appleSubscriptionId,
      seatCount: 1,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, registered.organizationId));
  await db
    .update(organizationBilling)
    .set({
      provider: "revenuecat",
      providerCustomerId: user.userId,
      providerProductId: "sync_team_5_monthly:monthly",
      providerSubscriptionId: playSubscriptionId,
      seatCount: 5,
      status: "active",
    })
    .where(eq(organizationBilling.organizationId, restored.organizationId));

  const outcome = await processRevenueCatWebhook(
    getDefaultApiServiceRuntime(),
    {
      environment: "SANDBOX",
      event_timestamp_ms: Date.now(),
      id: crypto.randomUUID(),
      store: "PLAY_STORE",
      transferred_from: [crypto.randomUUID()],
      transferred_to: [user.userId],
      type: "TRANSFER",
    },
    {
      env: ENV,
      fetchImpl: (async (input: RequestInfo | URL) => {
        if (String(input).includes("/products/")) {
          return Response.json({
            store_identifier: "sync_team_5_monthly:monthly",
          });
        }
        return Response.json({
          items: [
            {
              current_period_ends_at: "2030-02-01T00:00:00Z",
              current_period_starts_at: "2030-01-01T00:00:00Z",
              environment: "sandbox",
              gives_access: true,
              product_id: "prod_team_5",
              status: "active",
              store: "play_store",
              store_subscription_identifier: playSubscriptionId,
            },
          ],
        });
      }) as typeof fetch,
    },
  );

  expect(outcome).toEqual({
    billingStatus: "active",
    organizationId: restored.organizationId,
    status: "applied",
  });
  const rows = await db
    .select({
      organizationId: organizationBilling.organizationId,
      subscriptionId: organizationBilling.providerSubscriptionId,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.providerCustomerId, user.userId));
  expect(rows).toEqual(
    expect.arrayContaining([
      {
        organizationId: registered.organizationId,
        subscriptionId: appleSubscriptionId,
      },
      {
        organizationId: restored.organizationId,
        subscriptionId: playSubscriptionId,
      },
    ]),
  );
});
