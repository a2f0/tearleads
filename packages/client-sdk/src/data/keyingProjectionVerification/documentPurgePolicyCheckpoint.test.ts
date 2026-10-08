import { expect, test } from "bun:test";
import { makeVerifiedPrincipalPolicy } from "@tearleads/crypto";
import {
  createContainerMutationResponseFromRequest,
  createTestExecSql,
} from "@tearleads/test-utils";
import type {
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  createMaterializedSyncFixture,
  createResponse,
} from "../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../test/helpers/documentPurge";
import { createExternallyAuthorizedPrincipalPolicySnapshots } from "../../../test/helpers/principalPolicySnapshots";
import { verifyPrincipalPolicySnapshots } from "../../../test/helpers/principalPolicySnapshotVerification";
import { createProjectionPolicyEvidence } from "../../../test/helpers/projectionPolicyEvidence";
import { projectionPolicyWarmer } from "../../../test/helpers/projectionPolicyHistory";
import { buildMaterializedContainerSharePlan } from "../../workflows/containers/child/shareMaterialization";
import {
  buildMaterializedDocumentCreatePlan,
  documentWriterProjectionFromCreateResponse,
} from "../../workflows/documents/create";
import { loadDocumentPurgeCheckpoint } from "../persistence/documentPurgeCheckpointPersistence";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import type { ExecSql } from "../sqlite/sqlSchema";
import { verifyDocumentPurgeProof } from "./documentPurgeProofVerification";

function projectionAfterShare(
  previous: ContainerWriterProjectionResponse,
  response: ContainerMutationResponse,
): ContainerWriterProjectionResponse {
  return {
    ...previous,
    containerKeks: [
      ...previous.containerKeks.slice(0, -1),
      response.containerKek,
    ],
    path: [...previous.path.slice(0, -1), response.accessManifest],
  };
}

async function createGroupAuthorizedPurge(input: { execSql: ExecSql }) {
  const fixture = await createMaterializedSyncFixture();
  const policyFixture =
    await createExternallyAuthorizedPrincipalPolicySnapshots();
  const resolveUserKey = async (userId: string) =>
    (await fixture.resolveProjectionUserKey(userId)) ??
    policyFixture.resolveUserKey(userId);
  const policies = await verifyPrincipalPolicySnapshots({
    resolveUserKey,
    snapshots: [policyFixture.subject, policyFixture.admin],
  });
  const groupPolicy = policies.find(
    (policy) =>
      policy.principalId === policyFixture.subject.currentState.principalId,
  );
  if (!groupPolicy) throw new Error("Expected verified group policy");
  const share = await buildMaterializedContainerSharePlan({
    accessLevel: "read",
    author: fixture.author,
    execSql: input.execSql,
    previousProjection: fixture.projection,
    recipient: {
      principalPolicy: makeVerifiedPrincipalPolicy(groupPolicy),
      subjectId: groupPolicy.principalId,
      subjectType: "group",
    },
    resolveProjectionUserKey: resolveUserKey,
    targetSecretKey: fixture.secretKey,
  });
  const previousKek = fixture.projection.containerKeks.at(-1);
  const shareResponse = await createContainerMutationResponseFromRequest(
    share.plan.request,
    previousKek,
  );
  const sharedProjection = projectionAfterShare(
    fixture.projection,
    shareResponse,
  );
  const createPlan = await buildMaterializedDocumentCreatePlan({
    author: fixture.author,
    containerProjection: sharedProjection,
    execSql: input.execSql,
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
  });
  const documentResponse = createResponse(createPlan.plan);
  const writerProjection = documentWriterProjectionFromCreateResponse({
    containerProjection: sharedProjection,
    response: documentResponse,
  });
  const proof = await createDocumentPurgeProof(
    fixture.author,
    writerProjection,
  );
  const evidence = await createProjectionPolicyEvidence({
    author: fixture.author,
    group: policyFixture.subjectBundle,
    admins: policyFixture.adminBundle,
    signingPublicKey: fixture.signingPublicKey,
    encapsulationKeyPair: {
      publicKey: fixture.publicKey,
      secretKey: fixture.secretKey,
    },
  });
  return {
    warmer: projectionPolicyWarmer({
      bundles: evidence.bundles,
      execSql: input.execSql,
      resolveUserKey,
    }),
    organizationId: fixture.author.organizationId,
    policies,
    proof: {
      ...proof,
      policyEvidence: evidence.policyEvidence,
    },
    resolveUserKey,
    writerProjection,
  };
}

test("purge commit atomically pins first-seen policy snapshots", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-purge-policy-first-pin",
  );
  try {
    const fixture = await createGroupAuthorizedPurge({ execSql });
    const verified = await verifyDocumentPurgeProof({
      execSql,
      expectedDocumentId: fixture.writerProjection.documentId,
      expectedOrganizationId: fixture.organizationId,
      proof: fixture.proof,
      resolveUserKey: fixture.resolveUserKey,
      warmReferencedPrincipalPolicies: fixture.warmer,
    });
    await verified.commitCheckpoints(execSql);

    for (const policy of fixture.policies) {
      await expect(
        loadPrincipalPolicyCheckpoint(
          execSql,
          policy.principalType,
          policy.principalId,
        ),
      ).resolves.toMatchObject({
        stateHash: policy.stateHash,
        version: policy.version,
      });
    }
  } finally {
    close();
  }
});

for (const supersededPath of [false, true]) {
  test(`purge verification and commit reject a raced policy fork (superseded path: ${supersededPath})`, async () => {
    const { close, execSql } = await createTestExecSql(
      "document-purge-policy-race",
    );
    try {
      const fixture = await createGroupAuthorizedPurge({ execSql });
      const verification = {
        execSql,
        expectedDocumentId: fixture.writerProjection.documentId,
        expectedOrganizationId: fixture.organizationId,
        proof: fixture.proof,
        resolveUserKey: fixture.resolveUserKey,
        warmReferencedPrincipalPolicies: fixture.warmer,
      };
      const verified = await verifyDocumentPurgeProof(verification);
      const raced = fixture.policies[0];
      if (!raced) throw new Error("Expected a purge policy snapshot");
      await loadPrincipalPolicyCheckpoint(
        execSql,
        raced.principalType,
        raced.principalId,
      );
      await execSql(
        `INSERT INTO principal_policy_checkpoints
         (principal_type, principal_id, version, state_hash, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
        [
          raced.principalType,
          raced.principalId,
          raced.version,
          "d".repeat(64),
          "2026-08-27T00:00:00.000Z",
        ],
      );

      if (supersededPath) {
        const root = fixture.proof.authorizingContainerPath[0]?.state;
        if (!root) throw new Error("Expected signed root identity");
        const { containerId, epoch } = root;
        if (typeof containerId !== "string" || typeof epoch !== "number")
          throw new Error("Expected signed root identity");
        // Model a previously authenticated durable head independently of the
        // forked principal checkpoint. Real signed advances are covered by the
        // ancestor/leaf currency fixtures.
        await execSql(
          `INSERT OR REPLACE INTO access_manifest_checkpoints
        (object_kind, organization_id, object_id, epoch, manifest_hash, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
          [
            "container",
            fixture.organizationId,
            containerId,
            epoch + 1,
            "e".repeat(64),
            "2026-09-28T00:00:00.000Z",
          ],
        );
      }
      await expect(
        verifyDocumentPurgeProof(verification),
      ).rejects.toMatchObject({ code: "equivocation" });

      await expect(verified.commitCheckpoints(execSql)).rejects.toMatchObject({
        code: "equivocation",
      });
      await expect(
        loadDocumentPurgeCheckpoint(
          execSql,
          fixture.writerProjection.documentId,
        ),
      ).resolves.toBeNull();
    } finally {
      close();
    }
  });
}
