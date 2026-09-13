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
import {
  createMaterializedSyncFixture,
  fixtureHash,
} from "../../../test/helpers/documentFixtures";
import { createDocumentPurgeProof } from "../../../test/helpers/documentPurge";
import { verifyDocumentPurgeProof } from "./documentPurgeProofVerification";
import { runWithSecurityIncidentReporting } from "./error";

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
            expectedDocumentId: proof.documentId,
            expectedOrganizationId: fixture.author.organizationId,
            proof,
            resolveUserKey: fixture.resolveProjectionUserKey,
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
