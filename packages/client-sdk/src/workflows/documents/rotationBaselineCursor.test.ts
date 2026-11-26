import { expect, test } from "bun:test";
import {
  computeDocumentContentRecordMetadataHash,
  type WriteHeader,
} from "@tearleads/crypto";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
  exportFullHistorySnapshot,
  getImportBlobMetadata,
  importUpdates,
  versionVectorsEqual,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import {
  createAuthor,
  fixtureHash,
} from "../../../test/helpers/data/documentFixtures";
import { SMALL_BASELINE_SEGMENTS } from "../../../test/helpers/data/rotationBaselineFixtures";
import { decryptDocumentSyncUpdates } from "../../data/documents/shared/crypto";
import { documentVerdictJudge } from "../../data/documents/shared/sync/documentUpdateVerdict";
import { ensureDocumentTables } from "../../data/persistence/documents/records";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { buildDocumentRotationBaseline } from "./rotationBaseline";

type Author = Awaited<ReturnType<typeof createAuthor>>["author"];

function headerOf(update: DocumentOutgoingUpdate): WriteHeader {
  return update.writeHeader as unknown as WriteHeader;
}

/** The segments as a reader is served them, decrypted in order. */
function decryptSegments(input: {
  author: Author;
  baseline: readonly DocumentOutgoingUpdate[];
  contentKey: Uint8Array;
  documentId: string;
}) {
  return decryptDocumentSyncUpdates({
    contentKey: input.contentKey,
    contentKeyEpoch: 2,
    documentId: input.documentId,
    organizationId: input.author.organizationId,
    updates: input.baseline.map((segment) => ({
      ...segment,
      // This unit tests ciphertext/signature generation, not remote authority.
      authorizationTargets: [],
      accessEpoch: 2,
      authorFingerprint: input.author.signerKeyFingerprint,
      createdAt: "2026-07-14T00:00:00.000Z",
      documentId: input.documentId,
    })),
  });
}

function recordCursorWith(
  execSql: ExecSql,
  documentId: string,
  throughUpdateId: string,
) {
  return (throughVersion: string) =>
    execSql(
      `INSERT OR REPLACE INTO document_sync_progress (app_kind, local_id,
         document_id, through_update_id, through_version, judge)
       VALUES ('documents', 'local', ?, ?, ?, ?)`,
      [documentId, throughUpdateId, throughVersion, documentVerdictJudge()],
    );
}

// The API weighs only updates committed after a baseline's signed cursor, so
// a baseline signs one only when its history holds what that cursor's pull
// imported: otherwise it would stand for updates it does not hold. The cursor
// is the group's, signed on its final segment alone.
test("an unlink baseline signs the processed cursor its history covers", async () => {
  const { author } = await createAuthor();
  const document = await createDocument("cursor-rotation-baseline");
  document.getText("text").update("judged ".repeat(60));
  document.commit();
  const judged = encodeVersionVector(document);
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
        segmentSizes: SMALL_BASELINE_SEGMENTS,
        signedAt: "2026-07-14T00:00:00.000Z",
        snapshot,
      });
    const recordCursor = recordCursorWith(execSql, documentId, throughUpdateId);
    const cursors = (baseline: readonly DocumentOutgoingUpdate[] | null) =>
      (baseline ?? []).map((segment) => segment.coversThroughUpdateId);

    const uncursored = await build(exportFullHistorySnapshot(document));
    expect(uncursored?.length).toBeGreaterThan(1);
    expect(new Set(cursors(uncursored))).toEqual(new Set([undefined]));

    await recordCursor(judged);
    const covering = await build(exportFullHistorySnapshot(document));
    if (!covering) throw new Error("Expected a rotation baseline");
    expect(cursors(covering)).toEqual([
      ...covering.slice(0, -1).map(() => undefined),
      throughUpdateId,
    ]);
    const final = covering.at(-1);
    if (!final) throw new Error("Expected a final segment");
    expect(headerOf(final).metadataHash).toBe(
      await computeDocumentContentRecordMetadataHash({
        baselineId: final.baselineId,
        baselineSegmentCount: covering.length,
        baselineSegmentIndex: covering.length - 1,
        baselineSegmentsDigest: final.baselineSegmentsDigest,
        coversThroughUpdateId: throughUpdateId,
        dependencyVersionVector: final.dependencyVersionVector,
        documentId,
        partialEndVersionVector: final.partialEndVersionVector,
        partialStartVersionVector: final.partialStartVersionVector,
        plaintextHash: final.plaintextHash,
        updateId: final.id,
      }),
    );

    // A cursor recorded past what the history holds is not signed.
    document.getText("text").update("judged later");
    document.commit();
    await recordCursor(encodeVersionVector(document));
    const behind = await createDocument("behind-rotation-baseline");
    behind.getText("text").update("judged");
    behind.commit();
    expect(
      new Set(cursors(await build(exportFullHistorySnapshot(behind)))),
    ).toEqual(new Set([undefined]));
  } finally {
    close();
  }
});

// A reader that voided every update holds an empty document. Its baseline is
// one empty segment signing the cursor, so the API weighs only the updates
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
    const recordCursor = recordCursorWith(execSql, documentId, throughUpdateId);

    // A cursor recorded at a version the empty history lacks is not signed.
    document.getText("text").update("judged");
    document.commit();
    await recordCursor(encodeVersionVector(document));
    expect(await build()).toBeNull();

    await recordCursor(emptyVersionVector());
    const baseline = await build();
    const [segment, ...rest] = baseline ?? [];
    if (!segment || rest.length > 0) {
      throw new Error("Expected an empty rotation baseline of one segment");
    }
    expect(segment.coversThroughUpdateId).toBe(throughUpdateId);
    expect(segment.baselineSegmentIndex).toBe(0);
    expect(segment.baselineSegmentCount).toBe(1);
    for (const vector of [
      segment.partialStartVersionVector,
      segment.partialEndVersionVector,
      segment.dependencyVersionVector,
    ]) {
      expect(versionVectorsEqual(vector, emptyVersionVector())).toBe(true);
    }
    const [decrypted] = await decryptSegments({
      author,
      baseline: [segment],
      contentKey,
      documentId,
    });
    if (!decrypted) throw new Error("Expected the empty segment to decrypt");
    // The empty segment is an update blob that carries no operation.
    expect(getImportBlobMetadata(decrypted.updateData).mode).toBe("update");
    const reader = await createDocument("all-void-baseline-reader");
    importUpdates(reader, [decrypted.updateData]);
    expect(encodeVersionVector(reader)).toBe(emptyVersionVector());
    expect(headerOf(segment).metadataHash).toBe(
      await computeDocumentContentRecordMetadataHash({
        baselineId: segment.baselineId,
        baselineSegmentCount: 1,
        baselineSegmentIndex: 0,
        baselineSegmentsDigest: segment.baselineSegmentsDigest,
        coversThroughUpdateId: throughUpdateId,
        dependencyVersionVector: emptyVersionVector(),
        documentId,
        partialEndVersionVector: segment.partialEndVersionVector,
        partialStartVersionVector: segment.partialStartVersionVector,
        plaintextHash: segment.plaintextHash,
        updateId: segment.id,
      }),
    );
  } finally {
    close();
  }
});
