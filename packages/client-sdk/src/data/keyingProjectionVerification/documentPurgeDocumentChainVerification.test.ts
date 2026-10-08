import { expect, test } from "bun:test";
import { makeVerifiedContainerAccessManifest } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPurgeChainFixture } from "../../../test/helpers/documentPurgeChain";
import { createExternallyAuthorizedPrincipalPolicySnapshots } from "../../../test/helpers/principalPolicySnapshots";
import { verifyPrincipalPolicySnapshots } from "../../../test/helpers/principalPolicySnapshotVerification";
import { createProjectionCheckpointContext } from "./checkpointContext";
import { verifyContainerWriterProjection } from "./containerProjectionVerification";
import { verifyDocumentWriterProjection } from "./documentProjectionVerification";
import { verifyPurgeDocumentManifest } from "./documentPurgeDocumentChainVerification";
import { verifyDocumentPurgeProof } from "./documentPurgeProofVerification";
import { runWithSecurityIncidentReporting } from "./error";

test("a compact purge proof verifies transitions from a non-genesis pin", async () => {
  const fixture = await createPurgeChainFixture();
  const { close, execSql } = await createTestExecSql(
    "document-purge-signed-chain",
  );
  try {
    await verifyDocumentWriterProjection({
      execSql,
      projection: fixture.linkedProjection,
      resolveUserKey: fixture.resolveProjectionUserKey,
    });
    const verified = await verifyDocumentPurgeProof({
      execSql,
      expectedDocumentId: fixture.writerProjection.documentId,
      expectedOrganizationId: fixture.author.organizationId,
      proof: {
        ...fixture.proof,
        documentManifestPredecessors: [
          fixture.linkedProjection.documentManifest,
        ],
      },
      resolveUserKey: fixture.resolveProjectionUserKey,
    });
    expect(verified.documentCheckpoint.manifestHash).toBe(
      fixture.proof.documentManifest.manifestHash,
    );
  } finally {
    close();
  }
});

test("signed purge history uses retained group evidence after group deletion", async () => {
  const fixture = await createPurgeChainFixture();
  const policyFixture =
    await createExternallyAuthorizedPrincipalPolicySnapshots();
  const { close, execSql } = await createTestExecSql(
    "document-purge-deleted-group-chain",
  );
  const resolveUserKey = async (userId: string) =>
    (await fixture.resolveProjectionUserKey(userId)) ??
    policyFixture.resolveUserKey(userId);
  try {
    await verifyDocumentWriterProjection({
      execSql,
      projection: fixture.writerProjection,
      resolveUserKey,
    });
    const authorizationEvidence = await verifyPrincipalPolicySnapshots({
      resolveUserKey,
      snapshots: [policyFixture.subject, policyFixture.admin],
    });
    const [originalPath, extraPath] = await Promise.all([
      verifyContainerWriterProjection({
        execSql,
        projection: fixture.projection,
        resolveUserKey,
      }),
      verifyContainerWriterProjection({
        execSql,
        projection: fixture.extraProjection,
        resolveUserKey,
      }),
    ]);
    const originalLeaf = originalPath.at(-1);
    if (!originalLeaf) throw new Error("Expected original container leaf");
    const extraLeaf = extraPath.at(-1);
    if (!extraLeaf) throw new Error("Expected extra container leaf");
    const groupState = policyFixture.subject.currentState;
    if (groupState.principalType !== "group") {
      throw new Error("Expected deleted group evidence");
    }
    const managedLeaf = makeVerifiedContainerAccessManifest({
      ...originalLeaf,
      state: {
        ...originalLeaf.state,
        directGrants: [
          ...originalLeaf.state.directGrants,
          {
            accessLevel: "read",
            subjectId: groupState.principalId,
            subjectType: "group",
          },
        ],
        referencedPrincipalHeads: [
          {
            keyEpoch: groupState.keyEpoch,
            keyFingerprint: groupState.keyFingerprint,
            principalId: groupState.principalId,
            principalType: groupState.principalType,
            stateHash: groupState.stateHash,
            version: groupState.version,
          },
        ],
      },
    });
    const containerPathByManifestHash = new Map([
      [managedLeaf.manifestHash, [...originalPath.slice(0, -1), managedLeaf]],
      [extraLeaf.manifestHash, extraPath],
    ]);

    await expect(
      verifyPurgeDocumentManifest({
        authorizationEvidence,
        checkpointContext: createProjectionCheckpointContext({ execSql }),
        containerPathByManifestHash,
        enforceLocalCheckpoints: true,
        principalPolicyCache: new Map(),
        proof: fixture.proof,
        resolveUserKey,
      }),
    ).resolves.toMatchObject({
      manifestHash: fixture.proof.documentManifest.manifestHash,
    });
  } finally {
    close();
  }
});

test("document purge rejects a tampered intermediate signed transition", async () => {
  const fixture = await createPurgeChainFixture();
  const { close, execSql } = await createTestExecSql(
    "document-purge-signed-chain",
  );
  try {
    await verifyDocumentWriterProjection({
      execSql,
      projection: fixture.writerProjection,
      resolveUserKey: fixture.resolveProjectionUserKey,
    });
    const tampered = structuredClone(fixture.proof);
    const intermediate = tampered.documentManifestPredecessors[0];
    if (!intermediate) throw new Error("Expected document predecessor");
    Reflect.set(
      intermediate.event.event,
      "signedAt",
      "2026-08-26T13:00:00.000Z",
    );

    await expect(
      verifyDocumentPurgeProof({
        execSql,
        expectedDocumentId: fixture.writerProjection.documentId,
        expectedOrganizationId: fixture.author.organizationId,
        proof: tampered,
        resolveUserKey: fixture.resolveProjectionUserKey,
      }),
    ).rejects.toThrow("signature verification failed");
  } finally {
    close();
  }
});

test("a missing signed purge predecessor is recorded as integrity evidence", async () => {
  const fixture = await createPurgeChainFixture();
  const { close, execSql } = await createTestExecSql(
    "purge-missing-predecessor",
  );
  const incidents: unknown[] = [];
  try {
    await verifyDocumentWriterProjection({
      execSql,
      projection: fixture.writerProjection,
      resolveUserKey: fixture.resolveProjectionUserKey,
    });
    const proof = {
      ...fixture.proof,
      documentManifestPredecessors:
        fixture.proof.documentManifestPredecessors.slice(1),
    };
    await expect(
      runWithSecurityIncidentReporting(
        async (error) => {
          incidents.push(error);
        },
        {
          operation: "document.purge",
          objectKind: "document",
          objectId: proof.documentId,
        },
        () =>
          verifyDocumentPurgeProof({
            execSql,
            expectedDocumentId: proof.documentId,
            expectedOrganizationId: fixture.author.organizationId,
            proof,
            resolveUserKey: fixture.resolveProjectionUserKey,
          }),
      ),
    ).rejects.toMatchObject({ code: "missing_dependency" });
    expect(incidents).toHaveLength(1);
  } finally {
    close();
  }
});
