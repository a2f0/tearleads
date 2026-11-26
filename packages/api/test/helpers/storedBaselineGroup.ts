import { randomUUID } from "node:crypto";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentContentWriteHeaders,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import {
  computeDocumentBaselineSegmentsDigest,
  computeDocumentContentRecordMetadataHash,
  type DocumentBaselineSegmentDigestEntry,
  type WriteHeader,
} from "@tearleads/crypto";
import { insertDocumentUpdateSpans } from "../../src/documents/documentUpdateSpans";
import type {
  BaselineSegmentFields,
  BaselineSegmentRange,
} from "./documentBaselineGroups";

export interface StoredBaselineGroupFixture {
  readonly baselineId: string;
  readonly firstSequence: number;
  readonly lastSequence: number;
  /** The segments' update ids, in index order. */
  readonly updateIds: readonly string[];
}

/**
 * Store a rotation baseline as the API commits one: its segments as update
 * rows in index order from one insert, each with the group fields its
 * metadata hash signs, and their write headers. The headers carry only what
 * the read path reads from them; nothing here verifies a signature.
 */
export async function insertStoredBaselineGroup(input: {
  readonly baselineId?: string | undefined;
  readonly contentKeyEpoch: number;
  /** Stores this segment's header with a metadata hash it never signed. */
  readonly corruptMetadataHashAt?: number | undefined;
  readonly coversThroughUpdateId?: string | undefined;
  readonly documentId: string;
  readonly ranges: readonly BaselineSegmentRange[];
  /** Also stores the segments' spans, as an append does. */
  readonly withSpans?: boolean | undefined;
}): Promise<StoredBaselineGroupFixture> {
  const baselineId = input.baselineId ?? randomUUID();
  const entries: DocumentBaselineSegmentDigestEntry[] = [];
  const rows = [];
  for (const [index, range] of input.ranges.entries()) {
    const id = randomUUID();
    const final = index === input.ranges.length - 1;
    const fields: BaselineSegmentFields = {
      baselineId,
      baselineSegmentIndex: index,
      ...(final
        ? {
            baselineSegmentCount: input.ranges.length,
            baselineSegmentsDigest: await computeDocumentBaselineSegmentsDigest(
              {
                baselineId,
                documentId: input.documentId,
                segments: entries,
              },
            ),
            coversThroughUpdateId: input.coversThroughUpdateId,
          }
        : {}),
    };
    const dependencyVersionVector =
      range.dependencyVersionVector ?? range.partialStartVersionVector;
    const plaintextHash = `plaintext-${id}`;
    const metadataHash = await computeDocumentContentRecordMetadataHash({
      ...fields,
      dependencyVersionVector,
      documentId: input.documentId,
      partialEndVersionVector: range.partialEndVersionVector,
      partialStartVersionVector: range.partialStartVersionVector,
      plaintextHash,
      updateId: id,
    });
    const entry = {
      ciphertextHash: `ciphertext-${id}`,
      metadataHash,
      updateId: id,
    };
    entries.push(entry);
    rows.push({
      accessEpoch: 1,
      authorFingerprint: "stored-baseline-group",
      baselineCoversThroughUpdateId: fields.coversThroughUpdateId ?? null,
      baselineId,
      baselineSegmentCount: fields.baselineSegmentCount ?? null,
      baselineSegmentIndex: index,
      baselineSegmentsDigest: fields.baselineSegmentsDigest ?? null,
      byteLength: 26,
      dependencyVersionVector,
      documentId: input.documentId,
      encryptedData: "encrypted-baseline-segment",
      id,
      partialEndVersionVector: range.partialEndVersionVector,
      partialStartVersionVector: range.partialStartVersionVector,
      plaintextHash,
    });
  }
  const inserted = await db
    .insert(documentUpdates)
    .values(rows)
    .returning({ id: documentUpdates.id, sequence: documentUpdates.sequence });
  await db.insert(documentContentWriteHeaders).values(
    entries.map((entry, index) => ({
      // This fixture stores baseline metadata, not write authorization.
      authorizationTargets: [],
      contentKeyEpoch: input.contentKeyEpoch,
      contentRecordId: entry.updateId,
      documentId: input.documentId,
      header: {
        ciphertextHash: entry.ciphertextHash,
        contentKeyEpoch: input.contentKeyEpoch,
        metadataHash:
          index === input.corruptMetadataHashAt
            ? `tampered-${entry.updateId}`
            : entry.metadataHash,
      } as unknown as WriteHeader,
      headerHash: `header-${entry.updateId}`,
      nonceDomainHash: `nonce-${entry.updateId}`,
      organizationId: randomUUID(),
      updateId: entry.updateId,
    })),
  );
  if (input.withSpans) {
    await insertDocumentUpdateSpans(db, {
      documentId: input.documentId,
      updates: rows,
    });
  }
  const sequenceById = new Map(inserted.map((row) => [row.id, row.sequence]));
  const sequences = rows.map((row) => sequenceById.get(row.id) ?? Number.NaN);
  return {
    baselineId,
    firstSequence: Math.min(...sequences),
    lastSequence: Math.max(...sequences),
    updateIds: rows.map((row) => row.id),
  };
}
