import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { organizationBilling } from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { isCreateOrganizationResponse } from "@symcrypt/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import {
  createOrganizationRequestBody,
  submitCreateOrganization,
} from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";

test("POST /organizations durably replays a native restore destination", async () => {
  const user = createTestUser();
  await registerUser(user);
  await authenticate(user);
  const body = {
    ...(await createOrganizationRequestBody(user)),
    nativeSubscriptionRestore: true as const,
  };

  const [response, concurrentReplay] = await Promise.all([
    submitCreateOrganization(user, body),
    submitCreateOrganization(user, body),
  ]);
  expect([response.status, concurrentReplay.status]).toEqual([200, 200]);
  const provisioned: unknown = await response.json();
  invariant(isCreateOrganizationResponse(provisioned), "expected restore org");
  expect(await concurrentReplay.json()).toEqual(provisioned);
  const replay = await submitCreateOrganization(user, body);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(provisioned);

  const [billing] = await db
    .select({
      claimedAt: organizationBilling.nativeRestoreClaimedAt,
      response: organizationBilling.nativeRestoreProvisioningResponse,
      userId: organizationBilling.nativeRestoreUserId,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, body.organizationId));
  expect(billing).toEqual({
    claimedAt: null,
    response: provisioned,
    userId: user.userId,
  });
});
