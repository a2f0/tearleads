import { expect, test } from "bun:test";
import { makeVerifiedPrincipalPolicy } from "@symcrypt/crypto";
import {
  createContainerMutationResponseFromRequest,
  createTestExecSql,
} from "@symcrypt/test-utils";
import type {
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@symcrypt/validators/response";
import {
  createMaterializedSyncFixture,
  createResponse,
} from "../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../test/helpers/documentPurge";
import { createExternallyAuthorizedPrincipalPolicySnapshots } from "../../../test/helpers/principalPolicySnapshots";
import { buildMaterializedContainerSharePlan } from "../../workflows/containers/child/shareMaterialization";
import {
  buildMaterializedDocumentCreatePlan,
  documentWriterProjectionFromCreateResponse,
} from "../../workflows/documents/create";
import { loadDocumentPurgeCheckpoint } from "../persistence/documentPurgeCheckpointPersistence";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import type { ExecSql } from "../sqlite/sqlSchema";
import { verifyDocumentPurgeProof } from "./documentPurgeProofVerification";
import { verifyPrincipalPolicySnapshots } from "./principalPolicySnapshotVerification";

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
  return {
    policies,
    proof: {
      ...proof,
      principalPolicySnapshots: [policyFixture.subject, policyFixture.admin],
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
      proof: fixture.proof,
      resolveUserKey: fixture.resolveUserKey,
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

test("purge commit rolls back when a policy checkpoint races verification", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-purge-policy-race",
  );
  try {
    const fixture = await createGroupAuthorizedPurge({ execSql });
    const verified = await verifyDocumentPurgeProof({
      execSql,
      expectedDocumentId: fixture.writerProjection.documentId,
      proof: fixture.proof,
      resolveUserKey: fixture.resolveUserKey,
    });
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

    await expect(verified.commitCheckpoints(execSql)).rejects.toMatchObject({
      code: "equivocation",
    });
    await expect(
      loadDocumentPurgeCheckpoint(execSql, fixture.writerProjection.documentId),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
