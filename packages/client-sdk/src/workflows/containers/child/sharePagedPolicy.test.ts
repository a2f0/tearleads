import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import {
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { ContainerMutationRequestSchema } from "@tearleads/validators/request";
import { principalPolicyHead } from "../../../../test/helpers/principalPolicyFixtures";
import {
  createPrincipalReciteFixture,
  ROOT_CONTAINER_ID,
} from "../../../../test/helpers/principalReciteFixtures";
import {
  heldContainerSnapshot,
  rememberVerifiedContainerHeads,
} from "../../../data/containers/shared/heldContainerHeads";
import { readCanonicalJson } from "../../../data/keyingCanonicalJson";
import { verifyContainerWriterProjection } from "../../../data/keyingProjectionVerification";
import { recoverPrincipalPolicyHistory } from "../../principals/recoverPrincipalPolicyHistory";
import { buildMaterializedContainerSharePlan } from "./shareMaterialization";

test("a paged policy survives held-head cloning and signs a verifiable share plan", async () => {
  const groupId = crypto.randomUUID();
  const fixture = await createPrincipalReciteFixture({
    databaseName: "paged-share-plan",
    rotateKey: true,
    groupId,
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return Response.json({
        ...fixture.nextBundle,
        historyPage: { afterVersion: 0, nextAfterVersion: null },
      });
    },
  });
  try {
    const previousProjection =
      await fixture.input.apiClient.getContainerWriterProjection(
        ROOT_CONTAINER_ID,
      );
    if (!previousProjection) throw new Error("Missing previous projection");
    const previousPath = await verifyContainerWriterProjection({
      execSql: fixture.database.execSql,
      projection: previousProjection,
      resolveUserKey: fixture.input.resolveTrustedUserIdentity,
      warmReferencedPrincipalPolicies:
        fixture.input.warmReferencedPrincipalPolicies,
    });
    const recovered = await recoverPrincipalPolicyHistory({
      apiClient: new ApiClient(server.url.origin),
      execSql: fixture.database.execSql,
      organizationId: fixture.input.author.organizationId,
      expectedHead: principalPolicyHead(fixture.nextBundle),
      retainedReferences: [principalPolicyHead(fixture.previousBundle)],
      protection: {
        localKey: new Uint8Array(32).fill(4),
        context: "paged-share",
      },
      stillCurrent: () => true,
      resolveTrustedUserIdentity: fixture.input.resolveTrustedUserIdentity,
    });
    expect(recovered.policy).not.toHaveProperty("history");
    rememberVerifiedContainerHeads({
      execSql: fixture.database.execSql,
      organizationId: fixture.input.author.organizationId,
      heads: previousPath,
      policies: [recovered.policy],
    });
    const held = heldContainerSnapshot(
      fixture.database.execSql,
      fixture.input.author.organizationId,
    );
    const policy = held.policies.find(
      (policy) => policy.principalId === groupId,
    );
    if (!policy || !("retainedHistory" in policy))
      throw new Error("Missing held paged policy");
    expect(policy).not.toBe(recovered.policy);
    const materialized = await buildMaterializedContainerSharePlan({
      accessLevel: "admin",
      author: fixture.input.author,
      execSql: fixture.database.execSql,
      previousProjection,
      recipient: {
        subjectType: "group",
        subjectId: groupId,
        principalPolicy: policy,
      },
      resolveProjectionUserKey: fixture.input.resolveTrustedUserIdentity,
      warmReferencedPrincipalPolicies:
        fixture.input.warmReferencedPrincipalPolicies,
      targetSecretKey: fixture.input.targetSecretKey,
    });
    const plan = materialized.plan;
    expect(ContainerMutationRequestSchema.safeParse(plan.request).success).toBe(
      true,
    );
    expect(plan.request.principalPolicies).toEqual([
      expect.objectContaining({
        stateHash: policy.stateHash,
        version: policy.version,
      }),
    ]);
    const event = await verifySignedAccessEvent({
      body: readCanonicalJson(plan.body, "Share body"),
      event: plan.event,
      signerPublicKey: fixture.signingPublicKey,
    });
    if (!event.ok) throw event.error;
    const previousManifest = previousPath.at(-1);
    if (!previousManifest) throw new Error("Missing verified parent");
    const manifest = await verifyContainerAccessManifest({
      event: event.value,
      expectedManifestHash: plan.manifestHash,
      manifest: plan.manifest,
      previousManifest,
      previousContainerPath: previousPath,
      principalPolicies: [policy],
    });
    if (!manifest.ok) throw manifest.error;
    const kek = await verifyContainerKekState({
      containerManifest: manifest.value,
      containerManifestHistory: previousPath,
      keyEpoch: plan.keyEpoch,
      principalPolicies: [policy],
      userRecipientKeys: plan.userRecipientKeys,
      wraps: plan.wraps,
    });
    expect(kek.ok).toBe(true);
  } finally {
    server.stop(true);
    fixture.database.close();
  }
});
