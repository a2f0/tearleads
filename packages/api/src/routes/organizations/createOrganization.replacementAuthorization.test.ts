import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizations,
  users,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  generateSigningSeedAndKeyPair,
  organizationReplacementSigningBytes,
  sign,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import {
  createOrganizationRequestBody,
  submitCreateOrganization,
} from "../../../test/helpers/api";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { runStartOrganizationTrialWorkflow } from "../../workflows/billing/organizationBilling";

async function purgedActor() {
  const user = createTestUser();
  await registerUser(user);
  await authenticate(user);
  const [registered] = await db
    .select()
    .from(users)
    .where(eq(users.id, user.userId));
  if (!registered) throw new Error("Expected registered user");
  const oldOrganizationId = registered.defaultOrganizationId;
  await db
    .update(organizationBilling)
    .set({ status: "purged", purgedAt: new Date() })
    .where(eq(organizationBilling.organizationId, oldOrganizationId));
  const request = await createOrganizationRequestBody(user, {
    replacesOrganizationId: oldOrganizationId,
  });
  return { user, oldOrganizationId, request };
}

for (const field of [
  "replacesOrganizationId",
  "organizationId",
  "rootContainerId",
  "userId",
  "organizationStateHash",
  "adminGroupId",
  "adminGroupStateHash",
  "memberGroupId",
  "memberGroupStateHash",
  "rootMetadataDocumentId",
  "rootManifestHash",
] as const) {
  test(`replacement provisioning rejects a signed authorization with a different ${field}`, async () => {
    const { user, request } = await purgedActor();
    const proof = request.replacementAuthorization;
    if (!proof) throw new Error("Expected replacement proof");
    const changed = {
      ...proof,
      [field]: field.endsWith("Hash") ? "e".repeat(64) : crypto.randomUUID(),
    };
    changed.signature = bytesToBase64(
      sign(
        organizationReplacementSigningBytes(changed),
        user.signing.signingPrivateKey,
      ),
    );
    const response = await submitCreateOrganization(user, {
      ...request,
      replacementAuthorization: changed,
    });
    expect(response.status).toBe(400);
    expect(
      await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, request.organizationId)),
    ).toEqual([]);
  });
}

test.each(["missing", "wrong signer"] as const)(
  "replacement provisioning rejects %s authorization",
  async (attack) => {
    const { user, request } = await purgedActor();
    const proof = request.replacementAuthorization;
    if (!proof) throw new Error("Expected replacement proof");
    const { replacementAuthorization: _authorization, ...unsignedRequest } =
      request;
    const response = await submitCreateOrganization(user, {
      ...unsignedRequest,
      ...(attack === "missing"
        ? {}
        : {
            replacementAuthorization: {
              ...proof,
              signature: bytesToBase64(
                sign(
                  organizationReplacementSigningBytes(proof),
                  generateSigningSeedAndKeyPair().signingPrivateKey,
                ),
              ),
            },
          }),
    });
    expect(response.status).toBe(400);
    expect(
      await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, request.organizationId)),
    ).toEqual([]);
  },
);

test.each(["replay", "finalization"] as const)(
  "replacement %s rechecks the signed authorization",
  async (stage) => {
    const { user, oldOrganizationId, request } = await purgedActor();
    expect((await submitCreateOrganization(user, request)).status).toBe(200);
    if (stage === "finalization")
      await runStartOrganizationTrialWorkflow(
        db,
        request.organizationId,
        user.userId,
      );
    const proof = request.replacementAuthorization;
    if (!proof) throw new Error("Expected replacement proof");
    const changed = { ...proof, rootManifestHash: "e".repeat(64) };
    changed.signature = bytesToBase64(
      sign(
        organizationReplacementSigningBytes(changed),
        user.signing.signingPrivateKey,
      ),
    );
    const response = await submitCreateOrganization(user, {
      ...request,
      ...(stage === "finalization" ? { finalizeReplacement: true } : {}),
      replacementAuthorization: changed,
    });
    expect(response.status).toBe(400);
    const [stored] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.userId));
    expect(stored?.defaultOrganizationId).toBe(oldOrganizationId);
  },
);

test("ordinary creation refuses replacement intent and returns a null authorization", async () => {
  const { user, request } = await purgedActor();
  const { replacesOrganizationId: _replaced, ...withProof } = request;
  expect((await submitCreateOrganization(user, withProof)).status).toBe(400);
  const { replacementAuthorization: _proof, ...ordinary } = withProof;
  const response = await submitCreateOrganization(user, ordinary);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    replacementAuthorization: null,
  });
});
