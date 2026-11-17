import { expect, test } from "bun:test";
import {
  type AccessEvent,
  computeAccessEventHash,
  signAccessEvent,
} from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import { toServedAccessManifestBundle } from "@tearleads/validators/util";
import { fixtureHash } from "../../../../test/helpers/data/documentFixtures";
import { createDocumentPurgeProof } from "../../../../test/helpers/workflows/documentPurge";
import { createPurgeChainFixture } from "../../../../test/helpers/workflows/documentPurgeChain";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import { verifyDocumentPurgeProof } from "../../../data/keyingProjectionVerification/documentPurge/documentPurgeProofVerification";
import { openPrincipalPolicyBundleReader } from "../../../data/persistence/principalPolicy/principalPolicyBundleRepository";
import { runWithSecurityIncidentReporting } from "../../../data/shared/securityIncidents";

test("a malformed unverified purge citation records one integrity incident", async () => {
  const fixture = await createMaterializedSyncFixture();
  const child = await createContainerWriterProjectionFixture({
    containerId: "purge-child",
    encapsulationPublicKey: fixture.publicKey,
    organizationId: fixture.author.organizationId,
    parentProjection: fixture.projection,
    signerKeyFingerprint: fixture.author.signerKeyFingerprint,
    signerPrivateKey: fixture.author.signerPrivateKey,
    userId: fixture.author.signerUserId,
  });
  const proof = structuredClone(
    await createDocumentPurgeProof(fixture.author, fixture.writerProjection),
  );
  const leaf = structuredClone(child.path.at(-1));
  const root = child.path[0];
  if (!leaf || !root) throw new Error("Expected child path");
  const citedHash = await fixtureHash("additional-purge-citation");
  const original = leaf.event.event as unknown as AccessEvent;
  const { signature: _signature, ...unsigned } = original;
  const event = await signAccessEvent(
    {
      ...unsigned,
      dependencyManifestHashes: [
        ...original.dependencyManifestHashes,
        citedHash,
      ],
    },
    fixture.author.signerPrivateKey,
  );
  proof.authorizingContainerPath = [
    root,
    {
      ...leaf,
      event: {
        ...leaf.event,
        event: { ...event },
        eventHash: await computeAccessEventHash(event),
      },
    },
  ];
  // The served state names no container, but citations are matched by the
  // hash-committed manifest: this one names the root again, so the leaf cites
  // two heads of one container.
  proof.documentContainerManifestHistory.push({
    ...root,
    manifestHash: citedHash,
    state: { ...(root.state as object), containerId: 47 },
  });
  const database = await createTestExecSql("purge-unverified-citation");
  const incidents: unknown[] = [];
  try {
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
            execSql: database.execSql,
            openPrincipalPolicyBundleReader,
            expectedDocumentId: proof.documentId,
            expectedOrganizationId: fixture.author.organizationId,
            proof,
            resolveUserKey: fixture.resolveProjectionUserKey,
          }),
      ),
    ).rejects.toMatchObject({
      name: "KeyingVerificationError",
      code: "duplicate_entry",
    });
    expect(incidents).toHaveLength(1);
  } finally {
    database.close();
  }
});

test("a pinned purge head served with compact state records one integrity incident", async () => {
  const fixture = await createPurgeChainFixture();
  const database = await createTestExecSql("purge-compact-head");
  const input = {
    execSql: database.execSql,
    openPrincipalPolicyBundleReader,
    expectedDocumentId: fixture.proof.documentId,
    expectedOrganizationId: fixture.author.organizationId,
    resolveUserKey: fixture.resolveProjectionUserKey,
  };
  const incidents: unknown[] = [];
  try {
    // Pin the head, so a retry verifies it as a hash-only snapshot of its
    // served state.
    const pinned = await verifyDocumentPurgeProof({
      ...input,
      proof: fixture.proof,
    });
    await pinned.commitCheckpoints(database.execSql);
    const retry = { ...fixture.proof, documentManifestPredecessors: [] };
    await expect(
      verifyDocumentPurgeProof({ ...input, proof: retry }),
    ).resolves.toBeDefined();
    // The compact state a writer projection serves cannot stand in for the
    // full stored state a snapshot is verified from.
    await expect(
      runWithSecurityIncidentReporting(
        async (error) => {
          incidents.push(error);
        },
        {
          operation: "document.purge",
          objectKind: "document",
          objectId: fixture.proof.documentId,
        },
        () =>
          verifyDocumentPurgeProof({
            ...input,
            proof: {
              ...retry,
              documentManifest: toServedAccessManifestBundle(
                fixture.proof.documentManifest,
              ),
            },
          }),
      ),
    ).rejects.toMatchObject({
      name: "KeyingVerificationError",
      code: "invalid_shape",
    });
    expect(incidents).toHaveLength(1);
  } finally {
    database.close();
  }
});
