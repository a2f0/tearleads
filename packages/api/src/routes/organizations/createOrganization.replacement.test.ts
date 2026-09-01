import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizations,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { authChallengeSigningBytes, sign } from "@tearleads/crypto";
import {
  isCreateOrganizationResponse,
  isVerifyResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import {
  createOrganizationRequestBody,
  requestChallenge,
  submitCreateOrganization,
  submitVerify,
} from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { runStartOrganizationTrialWorkflow } from "../../workflows/billing/organizationBilling";
import { assertOrganizationCanSync } from "../../workflows/billing/organizationSyncEligibility";

async function reauthenticateOrganizationId(
  user: ReturnType<typeof createTestUser>,
): Promise<string> {
  const challengeResponse = await requestChallenge(user.fingerprint);
  expect(challengeResponse.status).toBe(200);
  const challengeBody: unknown = await challengeResponse.json();
  invariant(
    typeof challengeBody === "object" &&
      challengeBody !== null &&
      typeof Reflect.get(challengeBody, "challenge") === "string",
    "expected challenge",
  );
  const challengeHex = Reflect.get(challengeBody, "challenge");
  invariant(typeof challengeHex === "string", "expected challenge string");
  const signature = sign(
    authChallengeSigningBytes({
      challengeHex,
      fingerprint: user.fingerprint,
    }),
    user.signing.signingPrivateKey,
  );
  const response = await submitVerify(user.fingerprint, signature);
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  invariant(
    isVerifyResponse(body) && body.authenticated,
    "expected authenticated response",
  );
  user.token = body.token;
  return body.organizationId;
}

test("replacement creation returns one winner to competing devices", async () => {
  const user = createTestUser();
  await registerUser(user);
  await authenticate(user);
  const [registered] = await db
    .select({ defaultOrganizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(registered, "expected registered user");
  await db
    .update(organizationBilling)
    .set({ purgedAt: new Date(), status: "purged" })
    .where(
      eq(organizationBilling.organizationId, registered.defaultOrganizationId),
    );
  const firstBody = {
    ...(await createOrganizationRequestBody(user)),
    replacesOrganizationId: registered.defaultOrganizationId,
  };
  const secondBody = {
    ...(await createOrganizationRequestBody(user)),
    replacesOrganizationId: registered.defaultOrganizationId,
  };

  const firstResponse = await submitCreateOrganization(user, firstBody);
  expect(firstResponse.status).toBe(200);
  const winner: unknown = await firstResponse.json();
  invariant(isCreateOrganizationResponse(winner), "expected replacement");
  const secondResponse = await submitCreateOrganization(user, secondBody);
  expect(secondResponse.status).toBe(200);
  expect(await secondResponse.json()).toEqual(winner);
  expect(winner.organizationId).toBe(firstBody.organizationId);
  expect(
    await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, secondBody.organizationId)),
  ).toHaveLength(0);
  const [replacementBilling] = await db
    .select({ status: organizationBilling.status })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, winner.organizationId));
  expect(replacementBilling?.status).toBe("local");
  const [waitingUser] = await db
    .select({ defaultOrganizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  expect(waitingUser?.defaultOrganizationId).toBe(
    registered.defaultOrganizationId,
  );
  expect(
    (
      await submitCreateOrganization(user, {
        ...secondBody,
        finalizeReplacement: true,
      })
    ).status,
  ).toBe(409);
  expect(await reauthenticateOrganizationId(user)).toBe(
    registered.defaultOrganizationId,
  );
  await expect(
    assertOrganizationCanSync(db, winner.organizationId, user.userId),
  ).rejects.toMatchObject({
    organizationId: winner.organizationId,
    reason: "billing_inactive",
    status: 402,
  });

  await runStartOrganizationTrialWorkflow(
    db,
    winner.organizationId,
    user.userId,
  );
  await expect(
    assertOrganizationCanSync(db, winner.organizationId, user.userId),
  ).resolves.toBeUndefined();

  const finalizationResponse = await submitCreateOrganization(user, {
    ...secondBody,
    finalizeReplacement: true,
  });
  expect(finalizationResponse.status).toBe(200);
  expect(await finalizationResponse.json()).toEqual(winner);
  expect(await reauthenticateOrganizationId(user)).toBe(winner.organizationId);
});
