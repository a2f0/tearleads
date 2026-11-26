import { expect, test } from "bun:test";
import {
  computeDocumentBaselineSegmentsDigest,
  computeDocumentContentRecordMetadataHash,
  verifyWriteHeader,
  type WriteHeader,
} from "@tearleads/crypto";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistoryIdentity,
  exportFullHistorySnapshot,
  getImportBlobMetadata,
  getTextValue,
  historySegmentsImportInOrder,
  importUpdates,
  mergeVersionVectors,
  versionVectorsEqual,
} from "@tearleads/loro";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import { MAX_DOCUMENT_BASELINE_SEGMENTS } from "@tearleads/validators/util";
import {
  createAuthor,
  fixtureHash,
} from "../../../test/helpers/data/documentFixtures";
import { SMALL_BASELINE_SEGMENTS } from "../../../test/helpers/data/rotationBaselineFixtures";
import { decryptDocumentSyncUpdates } from "../../data/documents/shared/crypto";
import { isDocumentSyncRequestLimitError } from "../../data/documents/shared/sync/documentSyncOutgoingBatch";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { buildDocumentRotationBaseline } from "./rotationBaseline";

/** A device that has recorded no processed cursor. */
const noCursorExecSql: ExecSql = async () => [];

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
  // A small document is the one-segment case: the whole group in one update.
  const [segment, ...rest] = baseline ?? [];
  if (!segment || rest.length > 0) {
    throw new Error("Expected a rotation baseline of one segment");
  }

  expect(segment.baselineSegmentIndex).toBe(0);
  expect(segment.baselineSegmentCount).toBe(1);
  expect(segment.baselineSegmentsDigest).toBe(
    await computeDocumentBaselineSegmentsDigest({
      baselineId: segment.baselineId ?? "",
      documentId,
      segments: [],
    }),
  );
  expect(segment.coversThroughUpdateId).toBeUndefined();
  // It carries the history from nothing to the document's version.
  expect(historySegmentsImportInOrder([segment])).toBe(true);
  expect(
    versionVectorsEqual(
      segment.partialEndVersionVector,
      encodeVersionVector(document),
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
    header: headerOf(segment),
    writerPublicKey: signingPublicKey,
  });
  expect(verified.ok).toBe(true);

  const [decrypted] = await decryptSegments({
    author,
    baseline: [segment],
    contentKey,
    documentId,
  });
  if (!decrypted) {
    throw new Error("Expected decrypted rotation baseline");
  }
  // A baseline is its history as update blobs, never a snapshot.
  expect(getImportBlobMetadata(decrypted.updateData).mode).toBe("update");
  expect(decrypted.baselineId).toBe(segment.baselineId);
  const freshReader = await createDocument("atomic-baseline-reader");
  importUpdates(freshReader, [decrypted.updateData]);
  expect(getTextValue(freshReader)).toBe("atomic baseline state");
});

test("a history over the segment target becomes a group of several segments", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const document = await createDocument("segmented-rotation-baseline");
  const other = await createDocument("segmented-rotation-baseline-peer");
  for (let round = 0; round < 12; round += 1) {
    document.getText("text").insert(0, `first writer round ${round} lorem\n`);
    document.commit();
    other.getText("text").insert(0, `second writer round ${round} ipsum\n`);
    other.commit();
    importUpdates(document, [other.export({ mode: "update" })]);
    importUpdates(other, [document.export({ mode: "update" })]);
  }
  const documentId = crypto.randomUUID();
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const baseline = await buildDocumentRotationBaseline({
    authorizingContainerPathRefs: [],
    author,
    execSql: noCursorExecSql,
    contentKey,
    contentKeyEpoch: 2,
    documentId,
    expectedLinkSetManifestHash: await fixtureHash("segmented-manifest"),
    expectedTargetHash: await fixtureHash("segmented-target"),
    organizationId: author.organizationId,
    segmentSizes: SMALL_BASELINE_SEGMENTS,
    signedAt: "2026-07-14T00:00:00.000Z",
    snapshot: exportFullHistorySnapshot(document),
  });
  if (!baseline) throw new Error("Expected a rotation baseline");
  expect(baseline.length).toBeGreaterThan(2);

  // Every segment names the group and its place; only the final one seals.
  const baselineId = baseline[0]?.baselineId ?? "";
  expect(baselineId).not.toBe("");
  const final = baseline.length - 1;
  expect(
    baseline.map((segment) => [
      segment.baselineId,
      segment.baselineSegmentIndex,
      segment.baselineSegmentCount,
      segment.baselineSegmentsDigest === undefined,
    ]),
  ).toEqual(
    baseline.map((_, index) => [
      baselineId,
      index,
      index === final ? baseline.length : undefined,
      index !== final,
    ]),
  );
  expect(new Set(baseline.map((segment) => segment.id)).size).toBe(
    baseline.length,
  );
  // The final segment's digest binds each earlier one's signed hashes.
  expect(baseline[final]?.baselineSegmentsDigest).toBe(
    await computeDocumentBaselineSegmentsDigest({
      baselineId,
      documentId,
      segments: baseline.slice(0, -1).map((segment) => ({
        ciphertextHash: headerOf(segment).ciphertextHash,
        metadataHash: headerOf(segment).metadataHash,
        updateId: segment.id,
      })),
    }),
  );
  // Each segment is an ordinary signed update with its group fields signed.
  for (const segment of baseline) {
    expect(headerOf(segment).metadataHash).toBe(
      await computeDocumentContentRecordMetadataHash({
        baselineId: segment.baselineId,
        baselineSegmentCount: segment.baselineSegmentCount,
        baselineSegmentIndex: segment.baselineSegmentIndex,
        baselineSegmentsDigest: segment.baselineSegmentsDigest,
        dependencyVersionVector: segment.dependencyVersionVector,
        documentId,
        partialEndVersionVector: segment.partialEndVersionVector,
        partialStartVersionVector: segment.partialStartVersionVector,
        plaintextHash: segment.plaintextHash,
        updateId: segment.id,
      }),
    );
    expect(
      (
        await verifyWriteHeader({
          expectedAccessManifestHash: headerOf(segment).accessManifestHash,
          expectedObject: {
            objectId: documentId,
            objectKind: "document",
            organizationId: author.organizationId,
          },
          expectedTargetHash: headerOf(segment).targetHash,
          header: headerOf(segment),
          writerPublicKey: signingPublicKey,
        })
      ).ok,
    ).toBe(true);
  }
  // The declared ranges are what the API's group rules require: gapless
  // from zero, each depending only on earlier segments, reaching the
  // document's version together.
  expect(historySegmentsImportInOrder(baseline)).toBe(true);
  expect(
    versionVectorsEqual(
      mergeVersionVectors(
        baseline.map((segment) => segment.partialEndVersionVector),
      ),
      encodeVersionVector(document),
    ),
  ).toBe(true);

  // A reader that imports the decrypted segments holds the same history.
  const decrypted = await decryptSegments({
    author,
    baseline,
    contentKey,
    documentId,
  });
  expect(decrypted).toHaveLength(baseline.length);
  const reader = await createDocument("segmented-baseline-reader");
  importUpdates(
    reader,
    decrypted.map((segment) => segment.updateData),
  );
  expect(getTextValue(reader)).toBe(getTextValue(document));
  expect(exportFullHistoryIdentity(reader)).toBe(
    exportFullHistoryIdentity(document),
  );
});

// A baseline travels whole in the request that rotates. A history that
// cannot be cut to fit ends in the failure an oversized queued update ends
// in, whether it has too many segments or one operation over the cap.
test("a history that cannot be one request's baseline is a request-limit failure", async () => {
  const { author } = await createAuthor();
  const build = async (
    document: Awaited<ReturnType<typeof createDocument>>,
    segmentSizes: { maxBytes: number; targetBytes: number },
  ) =>
    buildDocumentRotationBaseline({
      authorizingContainerPathRefs: [],
      author,
      execSql: noCursorExecSql,
      contentKey: crypto.getRandomValues(new Uint8Array(32)),
      contentKeyEpoch: 2,
      documentId: crypto.randomUUID(),
      expectedLinkSetManifestHash: await fixtureHash("limit-manifest"),
      expectedTargetHash: await fixtureHash("limit-target"),
      organizationId: author.organizationId,
      segmentSizes,
      signedAt: "2026-07-14T00:00:00.000Z",
      snapshot: exportFullHistorySnapshot(document),
    });

  const long = await createDocument("too-many-segments-baseline");
  long.getText("text").insert(0, "x".repeat(8_000));
  long.commit();
  const tooMany = await build(long, { maxBytes: 256, targetBytes: 128 }).catch(
    (error: unknown) => error,
  );
  expect(isDocumentSyncRequestLimitError(tooMany)).toBe(true);
  expect(String(tooMany)).toContain(
    "has more segments than one request carries",
  );
  // The bound is the group's, not the document's: at a larger target the
  // same history is a baseline within it.
  const fitting = await build(long, { maxBytes: 4_096, targetBytes: 1_024 });
  expect(fitting?.length).toBeGreaterThan(1);
  expect(fitting?.length).toBeLessThanOrEqual(MAX_DOCUMENT_BASELINE_SEGMENTS);

  // One map value is one counter: it cannot be cut, so it cannot be carried.
  const wide = await createDocument("oversized-counter-baseline");
  wide.getMap("fields").set("value", "v".repeat(4_000));
  wide.commit();
  const tooLarge = await build(wide, { maxBytes: 512, targetBytes: 256 }).catch(
    (error: unknown) => error,
  );
  expect(isDocumentSyncRequestLimitError(tooLarge)).toBe(true);
  expect(String(tooLarge)).toContain("cannot carry one operation");
});

test("buildDocumentRotationBaseline requires a full-history snapshot", async () => {
  const { author } = await createAuthor();
  const document = await createDocument("not-a-snapshot-baseline");
  document.getText("text").update("an update is not a snapshot");
  document.commit();
  await expect(
    buildDocumentRotationBaseline({
      authorizingContainerPathRefs: [],
      author,
      execSql: noCursorExecSql,
      contentKey: crypto.getRandomValues(new Uint8Array(32)),
      contentKeyEpoch: 2,
      documentId: crypto.randomUUID(),
      expectedLinkSetManifestHash: await fixtureHash("update-manifest"),
      expectedTargetHash: await fixtureHash("update-target"),
      organizationId: author.organizationId,
      signedAt: "2026-07-14T00:00:00.000Z",
      snapshot: document.export({ mode: "update" }),
    }),
  ).rejects.toThrow(
    "Document unlink requires a full-history rotation snapshot",
  );
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
