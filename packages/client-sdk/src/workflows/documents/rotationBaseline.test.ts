import { expect, test } from "bun:test";
import {
  computeDocumentContentRecordMetadataHash,
  verifyWriteHeader,
  type WriteHeader,
} from "@tearleads/crypto";
import {
  createDocument,
  emptyVersionVector,
  exportFullHistorySnapshot,
  getImportBlobMetadata,
  getTextValue,
  importSnapshot,
  versionVectorsEqual,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createAuthor,
  fixtureHash,
} from "../../../test/helpers/data/documentFixtures";
import { decryptDocumentSyncUpdates } from "../../data/documents/shared/crypto";
import { documentVerdictJudge } from "../../data/documents/shared/sync/documentUpdateVerdict";
import { ensureDocumentTables } from "../../data/persistence/documents/records";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { buildDocumentRotationBaseline } from "./rotationBaseline";

/** A device that has recorded no processed cursor. */
const noCursorExecSql: ExecSql = async () => [];

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
    authorizingContainerPathRefs: [],
    author,
    execSql: noCursorExecSql,
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

test("buildDocumentRotationBaseline returns null for an empty document with no cursor", async () => {
  const { author } = await createAuthor();
  const document = await createDocument("empty-rotation-baseline");
  const snapshot = exportFullHistorySnapshot(document);
  const baseline = await buildDocumentRotationBaseline({
    authorizingContainerPathRefs: [],
    author,
    execSql: noCursorExecSql,
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

// The API weighs only updates committed after a baseline's signed cursor, so
// a baseline signs one only when its snapshot holds what that cursor's pull
// imported: otherwise it would stand for updates it does not hold.
test("an unlink baseline signs the processed cursor its snapshot covers", async () => {
  const { author } = await createAuthor();
  const document = await createDocument("cursor-rotation-baseline");
  document.getText("text").update("judged");
  document.commit();
  const judged = getImportBlobMetadata(
    exportFullHistorySnapshot(document),
  ).partialEndVersionVector;
  const documentId = crypto.randomUUID();
  const throughUpdateId = crypto.randomUUID();
  const { close, execSql } = await createTestExecSql("baseline-cursor");
  try {
    await ensureDocumentTables(execSql);
    const build = async (snapshot: Uint8Array) =>
      buildDocumentRotationBaseline({
        authorizingContainerPathRefs: [],
        author,
        contentKey: crypto.getRandomValues(new Uint8Array(32)),
        contentKeyEpoch: 2,
        documentId,
        execSql,
        expectedLinkSetManifestHash: await fixtureHash("cursor-manifest"),
        expectedTargetHash: await fixtureHash("cursor-target"),
        organizationId: author.organizationId,
        signedAt: "2026-07-14T00:00:00.000Z",
        snapshot,
      });
    const recordCursor = (throughVersion: string) =>
      execSql(
        `INSERT OR REPLACE INTO document_sync_progress (app_kind, local_id,
           document_id, through_update_id, through_version, judge)
         VALUES ('documents', 'local', ?, ?, ?, ?)`,
        [documentId, throughUpdateId, throughVersion, documentVerdictJudge()],
      );

    expect(
      (await build(exportFullHistorySnapshot(document)))?.coversThroughUpdateId,
    ).toBeUndefined();
    await recordCursor(judged);
    const covering = await build(exportFullHistorySnapshot(document));
    expect(covering?.coversThroughUpdateId).toBe(throughUpdateId);
    const header = covering?.writeHeader as unknown as WriteHeader;
    expect(header.metadataHash).toBe(
      await computeDocumentContentRecordMetadataHash({
        checkpointKind: "rotate_baseline",
        checkpointPayloadKind: "full_history_snapshot",
        coversThroughUpdateId: throughUpdateId,
        dependencyVersionVector: emptyVersionVector(),
        documentId,
        partialEndVersionVector: judged,
        partialStartVersionVector: emptyVersionVector(),
        plaintextHash: covering?.plaintextHash ?? "",
        sourceVersionVector: judged,
        updateId: covering?.id ?? "",
      }),
    );

    // A cursor recorded past what the snapshot holds is not signed.
    document.getText("text").update("judged later");
    document.commit();
    await recordCursor(
      getImportBlobMetadata(exportFullHistorySnapshot(document))
        .partialEndVersionVector,
    );
    const behind = await createDocument("behind-rotation-baseline");
    behind.getText("text").update("judged");
    behind.commit();
    expect(
      (await build(exportFullHistorySnapshot(behind)))?.coversThroughUpdateId,
    ).toBeUndefined();
  } finally {
    close();
  }
});

// A reader that voided every update holds an empty document. Its baseline is
// the empty snapshot signing the cursor, so the API weighs only the updates
// after it; with no baseline the API would refuse the unlink while any update
// is committed.
test("an empty document's unlink baseline signs the cursor alone", async () => {
  const { author } = await createAuthor();
  const document = await createDocument("all-void-rotation-baseline");
  const snapshot = exportFullHistorySnapshot(document);
  const documentId = crypto.randomUUID();
  const throughUpdateId = crypto.randomUUID();
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const { close, execSql } = await createTestExecSql("all-void-baseline");
  try {
    await ensureDocumentTables(execSql);
    const build = async () =>
      buildDocumentRotationBaseline({
        authorizingContainerPathRefs: [],
        author,
        contentKey,
        contentKeyEpoch: 2,
        documentId,
        execSql,
        expectedLinkSetManifestHash: await fixtureHash("all-void-manifest"),
        expectedTargetHash: await fixtureHash("all-void-target"),
        organizationId: author.organizationId,
        signedAt: "2026-07-14T00:00:00.000Z",
        snapshot,
      });
    const recordCursor = (throughVersion: string) =>
      execSql(
        `INSERT OR REPLACE INTO document_sync_progress (app_kind, local_id,
           document_id, through_update_id, through_version, judge)
         VALUES ('documents', 'local', ?, ?, ?, ?)`,
        [documentId, throughUpdateId, throughVersion, documentVerdictJudge()],
      );

    // A cursor recorded at a version the empty snapshot lacks is not signed.
    document.getText("text").update("judged");
    document.commit();
    await recordCursor(
      getImportBlobMetadata(exportFullHistorySnapshot(document))
        .partialEndVersionVector,
    );
    expect(await build()).toBeNull();

    await recordCursor(emptyVersionVector());
    const baseline = await build();
    if (!baseline) throw new Error("Expected an empty rotation baseline");
    expect(baseline.coversThroughUpdateId).toBe(throughUpdateId);
    for (const vector of [
      baseline.partialStartVersionVector,
      baseline.partialEndVersionVector,
      baseline.sourceVersionVector,
    ]) {
      expect(versionVectorsEqual(vector, emptyVersionVector())).toBe(true);
    }
    const [decrypted] = await decryptDocumentSyncUpdates({
      contentKey,
      contentKeyEpoch: 2,
      documentId,
      organizationId: author.organizationId,
      updates: [
        {
          ...baseline,
          authorizationTargets: [],
          accessEpoch: 2,
          authorFingerprint: author.signerKeyFingerprint,
          createdAt: "2026-07-14T00:00:00.000Z",
          documentId,
        },
      ],
    });
    expect(decrypted?.updateData).toEqual(snapshot);
    const header = baseline.writeHeader as unknown as WriteHeader;
    expect(header.metadataHash).toBe(
      await computeDocumentContentRecordMetadataHash({
        checkpointKind: "rotate_baseline",
        checkpointPayloadKind: "full_history_snapshot",
        coversThroughUpdateId: throughUpdateId,
        dependencyVersionVector: emptyVersionVector(),
        documentId,
        partialEndVersionVector: baseline.partialEndVersionVector,
        partialStartVersionVector: baseline.partialStartVersionVector,
        plaintextHash: baseline.plaintextHash,
        sourceVersionVector: baseline.partialEndVersionVector,
        updateId: baseline.id,
      }),
    );
  } finally {
    close();
  }
});
