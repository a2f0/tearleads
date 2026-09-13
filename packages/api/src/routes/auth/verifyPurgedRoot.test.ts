import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling, users } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { authChallengeSigningBytes, sign } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { requestChallenge, submitVerify } from "../../../test/helpers/api";
import { registerUser } from "../../../test/helpers/registerUser";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { runOrganizationPurgeMaintenance } from "../../services/billing/organizationPurge";

test("auth verify acknowledges a null root after organization data is purged", async () => {
  const user = createTestUser();
  await registerUser(user);
  const [registered] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  if (!registered) throw new Error("expected registered user");
  const organizationId = registered.organizationId;
  const now = new Date("2099-09-01T00:00:00Z");
  await db
    .update(organizationBilling)
    .set({
      status: "disabled",
      disabledAt: new Date(now.getTime() - 2_000),
      purgeAfter: new Date(now.getTime() - 1_000),
    })
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(
    await runOrganizationPurgeMaintenance(createServiceTestRuntime(), {
      now,
      organizationIds: [organizationId],
    }),
  ).toEqual({ claimed: 1, failed: 0, purged: 1 });
  const challengeResponse = await requestChallenge(user.fingerprint);
  expect(challengeResponse.status).toBe(200);
  const { challenge } = await challengeResponse.json();
  const response = await submitVerify(
    user.fingerprint,
    sign(
      authChallengeSigningBytes({
        challengeHex: challenge,
        fingerprint: user.fingerprint,
      }),
      user.signing.signingPrivateKey,
    ),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    authenticated: true,
    organizationId: organizationId,
    userId: user.userId,
    rootContainerId: null,
  });
});
