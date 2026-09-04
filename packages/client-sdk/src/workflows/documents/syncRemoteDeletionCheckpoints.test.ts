import { expect, test } from "bun:test";
import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { createContainerRevokeManifestFixture } from "../../../test/helpers/containerFixtures";
import {
  createMaterializedSyncFixture,
  fixtureHash,
} from "../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../test/helpers/documentPurge";
import { verifyDocumentPurgeProof } from "../../data/keyingProjectionVerification";
import { enforceAccessManifestCheckpoints } from "../../data/keyingProjectionVerification/accessManifestCheckpointEnforcement";
import { loadAccessManifestCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";

// A purge proof's authorizing path is a signed snapshot: it is checked
// against the container checkpoints this device holds, at verification and
// again inside the commit transaction, but never advances them.

test("a verified purge proof leaves container checkpoints untouched", async () => {
  // The purge's authorizing path is a signed snapshot verified at the
  // membership it referenced and exempt from the ancestor currency rule, so
  // it must not become this device's container checkpoint: a head that rule
  // would refuse would otherwise be taken as already accepted later.
  const { author, projection, resolveProjectionUserKey, writerProjection } =
    await createMaterializedSyncFixture();
  const purgeProof = await createDocumentPurgeProof(author, writerProjection);
  const { close, execSql } = await createTestExecSql(
    "purge-proof-container-checkpoints",
  );
  try {
    const verified = await verifyDocumentPurgeProof({
      execSql,
      expectedDocumentId: writerProjection.documentId,
      expectedOrganizationId: projection.organizationId,
      proof: purgeProof,
      resolveUserKey: resolveProjectionUserKey,
    });
    await verified.commitCheckpoints(execSql);
    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "container",
        projection.organizationId,
        projection.containerId,
      ),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("a purge proof verified before a container checkpoint advanced fails closed at commit", async () => {
  // The authorizing path is re-checked against the durable container
  // checkpoints inside the commit transaction even though it never advances
  // them, so a server that stalls the proof past a checkpoint advance cannot
  // slip a stale authorization through.
  const {
    author,
    projection,
    resolveProjectionUserKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const purgeContainerManifest = projection.path.at(-1);
  if (!purgeContainerManifest) {
    throw new Error("Expected purge container projection");
  }
  const purgeProof = await createDocumentPurgeProof(author, writerProjection);
  const { close, execSql } = await createTestExecSql(
    "purge-proof-checkpoint-race",
  );
  try {
    const verified = await verifyDocumentPurgeProof({
      execSql,
      expectedDocumentId: writerProjection.documentId,
      expectedOrganizationId: projection.organizationId,
      proof: purgeProof,
      resolveUserKey: resolveProjectionUserKey,
    });
    const newerContainerManifest = await createContainerRevokeManifestFixture({
      author,
      containerId: projection.containerId,
      containerKeyEpochId: "container-key-epoch-during-purge",
      eventId: "container-revoke-during-document-purge",
      keyringHash: await fixtureHash("purge-race-container-keyring"),
      organizationId: projection.organizationId,
      predecessorBridgeHash: await fixtureHash(
        "purge-race-container-predecessor-bridge",
      ),
      previousManifest:
        purgeContainerManifest as unknown as VerifiedContainerAccessManifest,
      signingPublicKey,
      subjectId: author.signerUserId,
      subjectType: "user",
    });
    await enforceAccessManifestCheckpoints({
      execSql,
      policies: [],
      verifiedHeads: [newerContainerManifest],
      verifiedManifests: [newerContainerManifest],
    });
    await expect(verified.commitCheckpoints(execSql)).rejects.toMatchObject({
      code: "rollback",
    });
    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "container",
        projection.organizationId,
        projection.containerId,
      ),
    ).resolves.toMatchObject({
      manifestHash: newerContainerManifest.manifestHash,
    });
  } finally {
    close();
  }
});
