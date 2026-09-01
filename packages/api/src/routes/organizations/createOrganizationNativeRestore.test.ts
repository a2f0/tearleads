import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { isCreateOrganizationResponse } from "@tearleads/validators/response";
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
  const { nativeSubscriptionRestore, ...provisioningBody } = body;
  const reorderedReplay = await submitCreateOrganization(user, {
    nativeSubscriptionRestore,
    ...provisioningBody,
  });
  expect(reorderedReplay.status).toBe(200);
  expect(await reorderedReplay.json()).toEqual(provisioned);
  const mismatchedReplay = await submitCreateOrganization(user, {
    ...(await createOrganizationRequestBody(user, {
      organizationId: body.organizationId,
      rootContainerId: body.rootContainerId,
    })),
    nativeSubscriptionRestore: true,
  });
  expect(mismatchedReplay.status).toBe(409);

  const [billing] = await db
    .select({
      claimedAt: organizationBilling.nativeRestoreClaimedAt,
      requestSha256: organizationBilling.nativeRestoreProvisioningRequestSha256,
      response: organizationBilling.nativeRestoreProvisioningResponse,
      userId: organizationBilling.nativeRestoreUserId,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, body.organizationId));
  expect(billing?.claimedAt).toBeNull();
  expect(billing?.requestSha256).toHaveLength(64);
  expect(billing?.response).toEqual(provisioned);
  expect(billing?.userId).toBe(user.userId);
});
