import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documents, documentUpdates } from "@tearleads/api-shared/schema";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeDocumentBaselineSegmentsDigest,
  type WriteHeader,
} from "@tearleads/crypto";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
} from "@tearleads/loro";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import {
  DOCUMENT_MUTATION_ERROR_CODES,
  DOCUMENT_SYNC_ERROR_CODES,
} from "@tearleads/validators/response";
import {
  type BaselineSegmentRange,
  baselineSegmentRanges,
} from "../../../../test/helpers/documentBaselineGroups";
import {
  assertAtomicRotationBaselineCoversCommittedFrontier,
  assertBaselinelessUnlinkHasEmptyCommittedFrontier,
} from "./atomicRotationBaseline";

function header(input: {
  documentId: string;
  id: string;
}): Omit<WriteHeader, "ciphertextHash" | "metadataHash"> {
  return {
    dependencyManifestHashes: [],
    version: 1,
    organizationId: crypto.randomUUID(),
    objectKind: "document",
    objectId: input.documentId,
    accessManifestHash: "rotation-manifest",
    contentKeyEpoch: 2,
    targetHash: "rotation-target",
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: input.id,
    nonceDomainHash: "rotation-nonce-domain",
    writerUserId: crypto.randomUUID(),
    writerDeviceId: crypto.randomUUID(),
    writerKeyFingerprint: "rotation-writer-fingerprint",
    signedAt: new Date().toISOString(),
    signature: "rotation-signature",
  };
}

/**
 * A group over `ranges` whose headers carry the hashes the group rules read.
 * The gate reads declared fields and those hashes; the append, which this
 * test does not run, verifies signatures and the metadata hash itself.
 */
async function rotationBaseline(input: {
  documentId: string;
  ranges: readonly BaselineSegmentRange[];
}): Promise<DocumentOutgoingUpdate[]> {
  const baselineId = crypto.randomUUID();
  const entries = input.ranges.map(() => {
    const updateId = crypto.randomUUID();
    return {
      ciphertextHash: `ciphertext-${updateId}`,
      metadataHash: `metadata-${updateId}`,
      updateId,
    };
  });
  const baselineSegmentsDigest = await computeDocumentBaselineSegmentsDigest({
    baselineId,
    documentId: input.documentId,
    segments: entries.slice(0, -1),
  });
  return input.ranges.map((range, index) => {
    const entry = entries[index];
    if (!entry) throw new Error("Missing digest entry");
    return {
      baselineId,
      baselineSegmentIndex: index,
      ...(index === input.ranges.length - 1
        ? { baselineSegmentCount: input.ranges.length, baselineSegmentsDigest }
        : {}),
      id: entry.updateId,
      dependencyVersionVector: range.partialStartVersionVector,
      encryptedData: "encrypted-rotation-baseline-segment",
      partialStartVersionVector: range.partialStartVersionVector,
      partialEndVersionVector: range.partialEndVersionVector,
      plaintextHash: `plaintext-${entry.updateId}`,
      writeHeader: {
        ...header({ documentId: input.documentId, id: entry.updateId }),
        ciphertextHash: entry.ciphertextHash,
        metadataHash: entry.metadataHash,
      },
    };
  });
}

async function committedDocument(label: string): Promise<{
  committedFrontier: string;
  documentId: string;
  staleFrontier: string;
}> {
  const documentId = crypto.randomUUID();
  await db.insert(documents).values({
    id: documentId,
    createdByFingerprint: label,
  });
  const document = await createDocument(`${label}-peer`);
  document.getText("text").update("first");
  document.commit();
  const staleFrontier = encodeVersionVector(document);
  document.getText("text").update("first second");
  document.commit();
  const committedFrontier = encodeVersionVector(document);
  await db.insert(documentUpdates).values({
    id: crypto.randomUUID(),
    documentId,
    accessEpoch: 1,
    authorFingerprint: "pre-rotation-writer",
    encryptedData: "encrypted-pre-rotation-update",
    byteLength: 29,
    dependencyVersionVector: emptyVersionVector(),
    partialStartVersionVector: emptyVersionVector(),
    partialEndVersionVector: committedFrontier,
    plaintextHash: "pre-rotation-plaintext-hash",
  });
  return { committedFrontier, documentId, staleFrontier };
}

test("atomic rotation baseline must cover the complete committed frontier", async () => {
  const { committedFrontier, documentId, staleFrontier } =
    await committedDocument("atomic-rotation-frontier-test");

  // What a group covers is what its segments reach together, so a group of
  // several segments that stops short is as stale as one segment that does.
  for (const segments of [1, 3]) {
    await expect(
      assertAtomicRotationBaselineCoversCommittedFrontier(db, {
        baseline: await rotationBaseline({
          documentId,
          ranges: baselineSegmentRanges(staleFrontier, segments),
        }),
        documentId,
      }),
    ).rejects.toMatchObject({
      code: DOCUMENT_MUTATION_ERROR_CODES.unlinkRotationBaselineStale,
      message: "Document unlink rotation baseline is stale",
      status: 409,
    });

    await expect(
      assertAtomicRotationBaselineCoversCommittedFrontier(db, {
        baseline: await rotationBaseline({
          documentId,
          ranges: baselineSegmentRanges(committedFrontier, segments),
        }),
        documentId,
      }),
    ).resolves.toBeUndefined();
  }
});

test("baseline-less unlink is allowed only for an empty committed frontier", async () => {
  const documentId = crypto.randomUUID();
  await db.insert(documents).values({
    id: documentId,
    createdByFingerprint: "baselineless-unlink-test",
  });

  await expect(
    assertBaselinelessUnlinkHasEmptyCommittedFrontier(db, { documentId }),
  ).resolves.toBeUndefined();

  const document = await createDocument("baselineless-unlink-peer");
  document.getText("text").update("committed content");
  document.commit();
  await db.insert(documentUpdates).values({
    id: crypto.randomUUID(),
    documentId,
    accessEpoch: 1,
    authorFingerprint: "baselineless-unlink-writer",
    encryptedData: "encrypted-committed-update",
    byteLength: 17,
    dependencyVersionVector: emptyVersionVector(),
    partialStartVersionVector: emptyVersionVector(),
    partialEndVersionVector: encodeVersionVector(document),
    plaintextHash: "committed-plaintext-hash",
  });

  await expect(
    assertBaselinelessUnlinkHasEmptyCommittedFrontier(db, { documentId }),
  ).rejects.toMatchObject({
    code: DOCUMENT_MUTATION_ERROR_CODES.unlinkRotationBaselineStale,
    message:
      "Document unlink requires a rotation baseline covering committed updates",
    status: 409,
  });
});

test("atomic rotation baseline must be one whole group", async () => {
  const { committedFrontier, documentId } = await committedDocument(
    "atomic-rotation-group-test",
  );
  const baseline = await rotationBaseline({
    documentId,
    ranges: baselineSegmentRanges(committedFrontier, 3),
  });
  expect(baseline).toHaveLength(3);
  const refused = {
    code: DOCUMENT_SYNC_ERROR_CODES.baselineGroupInvalid,
    status: 409,
  };

  // A group that covers the frontier is still refused when it is not whole:
  // the coverage read would trust spans the group rules never checked.
  await expect(
    assertAtomicRotationBaselineCoversCommittedFrontier(db, {
      baseline: baseline.toReversed(),
      documentId,
    }),
  ).rejects.toMatchObject({
    ...refused,
    message:
      "Document rotation baseline is not one whole group: the segments are not in index order from zero",
  });
  await expect(
    assertAtomicRotationBaselineCoversCommittedFrontier(db, {
      baseline: baseline.map(({ baselineId: _, ...update }) => update),
      documentId,
    }),
  ).rejects.toMatchObject(refused);
});
