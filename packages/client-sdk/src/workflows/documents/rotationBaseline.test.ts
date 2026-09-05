import { expect, test } from "bun:test";
import { verifyWriteHeader, type WriteHeader } from "@tearleads/crypto";
import {
  createDocument,
  emptyVersionVector,
  exportFullHistorySnapshot,
  getImportBlobMetadata,
  getTextValue,
  importSnapshot,
  versionVectorsEqual,
} from "@tearleads/loro";
import {
  createAuthor,
  fixtureHash,
} from "../../../test/helpers/documentFixtures";
import { decryptDocumentSyncUpdates } from "../../data/documents/shared/crypto";
import { buildDocumentRotationBaseline } from "./rotationBaseline";

test("buildDocumentRotationBaseline encrypts and signs against the new access boundary", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const document = await createDocument("atomic-rotation-baseline");
  document.getText("text").update("atomic baseline state");
  document.commit();
  const snapshot = exportFullHistorySnapshot(document);
  const documentId = crypto.randomUUID();
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const expectedLinkSetManifestHash = await fixtureHash(
    "new-link-set-manifest",
  );
  const expectedTargetHash = await fixtureHash("new-target-hash");
  const baseline = await buildDocumentRotationBaseline({
    author,
    contentKey,
    contentKeyEpoch: 2,
    documentId,
    expectedLinkSetManifestHash,
    expectedTargetHash,
    organizationId: author.organizationId,
    signedAt: "2026-07-14T00:00:00.000Z",
    snapshot,
  });
  if (!baseline) {
    throw new Error("Expected a rotation baseline for populated history");
  }

  expect(baseline.checkpointKind).toBe("rotate_baseline");
  expect(baseline.checkpointPayloadKind).toBe("full_history_snapshot");
  expect(
    versionVectorsEqual(
      baseline.partialStartVersionVector,
      emptyVersionVector(),
    ),
  ).toBe(true);
  expect(
    versionVectorsEqual(
      baseline.sourceVersionVector,
      baseline.partialEndVersionVector,
    ),
  ).toBe(true);
  const verified = await verifyWriteHeader({
    expectedAccessManifestHash: expectedLinkSetManifestHash,
    expectedObject: {
      objectId: documentId,
      objectKind: "document",
      organizationId: author.organizationId,
    },
    expectedTargetHash,
    header: baseline.writeHeader as unknown as WriteHeader,
    writerPublicKey: signingPublicKey,
  });
  expect(verified.ok).toBe(true);

  const [decrypted] = await decryptDocumentSyncUpdates({
    contentKey,
    contentKeyEpoch: 2,
    documentId,
    organizationId: author.organizationId,
    updates: [
      {
        ...baseline,
        // This unit tests ciphertext/signature generation, not remote authority.
        authorizationTargets: [],
        accessEpoch: 2,
        authorFingerprint: author.signerKeyFingerprint,
        createdAt: "2026-07-14T00:00:00.000Z",
        documentId,
      },
    ],
  });
  if (!decrypted) {
    throw new Error("Expected decrypted rotation baseline");
  }
  expect(getImportBlobMetadata(decrypted.updateData).mode).toBe("snapshot");
  const freshReader = await createDocument("atomic-baseline-reader");
  importSnapshot(freshReader, decrypted.updateData);
  expect(getTextValue(freshReader)).toBe("atomic baseline state");
});

test("buildDocumentRotationBaseline returns null for a zero-span empty document", async () => {
  const { author } = await createAuthor();
  const document = await createDocument("empty-rotation-baseline");
  const snapshot = exportFullHistorySnapshot(document);
  const baseline = await buildDocumentRotationBaseline({
    author,
    contentKey: crypto.getRandomValues(new Uint8Array(32)),
    contentKeyEpoch: 2,
    documentId: crypto.randomUUID(),
    expectedLinkSetManifestHash: await fixtureHash("empty-link-set-manifest"),
    expectedTargetHash: await fixtureHash("empty-target-hash"),
    organizationId: author.organizationId,
    signedAt: "2026-07-14T00:00:00.000Z",
    snapshot,
  });

  expect(baseline).toBeNull();
});
