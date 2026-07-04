import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { isOrganizationBillingResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { setTestOrganizationBillingLocal } from "../../../test/helpers/organizationBilling";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

async function registerAndAuthenticate(user: TestUser): Promise<string> {
  await registerUser(user);
  await authenticate(user);

  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));

  invariant(row, "expected registered user row");
  return row.organizationId;
}

function authHeader(user: TestUser): { Authorization: string } {
  return { Authorization: `Bearer ${user.token}` };
}

test("an org admin reads local billing and starts a trial", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  // Test registration enables sync by default; this test exercises the
  // local -> trial transition, so start from the provisioned `local` state.
  await setTestOrganizationBillingLocal(organizationId);

  const readResponse = await routeApp.request(
    `/organizations/${organizationId}/billing`,
    { headers: authHeader(admin) },
  );
  expect(readResponse.status).toBe(200);
  const billing = await readResponse.json();
  invariant(
    isOrganizationBillingResponse(billing),
    "expected billing response",
  );
  expect(billing.status).toBe("local");
  expect(billing.trialEndsAt).toBeNull();

  const trialResponse = await routeApp.request(
    `/organizations/${organizationId}/billing/trial`,
    { headers: authHeader(admin), method: "POST" },
  );
  expect(trialResponse.status).toBe(200);
  const trialing = await trialResponse.json();
  invariant(
    isOrganizationBillingResponse(trialing),
    "expected billing response",
  );
  expect(trialing.status).toBe("trialing");
  expect(trialing.trialEndsAt).not.toBeNull();

  // Starting the trial again is idempotent, not an error.
  const trialAgain = await routeApp.request(
    `/organizations/${organizationId}/billing/trial`,
    { headers: authHeader(admin), method: "POST" },
  );
  expect(trialAgain.status).toBe(200);
  const stillTrialing = await trialAgain.json();
  invariant(
    isOrganizationBillingResponse(stillTrialing),
    "expected billing response",
  );
  expect(stillTrialing.status).toBe("trialing");
});

test("a non-member cannot read or change another org's billing", async () => {
  const owner = createTestUser();
  const organizationId = await registerAndAuthenticate(owner);
  const intruder = createTestUser();
  await registerAndAuthenticate(intruder);

  const readResponse = await routeApp.request(
    `/organizations/${organizationId}/billing`,
    { headers: authHeader(intruder) },
  );
  expect(readResponse.status).toBe(403);

  const trialResponse = await routeApp.request(
    `/organizations/${organizationId}/billing/trial`,
    { headers: authHeader(intruder), method: "POST" },
  );
  expect(trialResponse.status).toBe(403);
});
