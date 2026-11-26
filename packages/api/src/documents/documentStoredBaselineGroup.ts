import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  documentContentWriteHeaders,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { computeDocumentContentRecordMetadataHash } from "@tearleads/crypto";
import type { DocumentUpdateRecord } from "@tearleads/loro/server";
import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import {
  type DocumentBaselineGroup,
  judgeDocumentBaselineGroup,
} from "./documentBaselineGroup";

type StoredBaselineFields = Pick<
  DocumentUpdateRecord,
  | "baselineCoversThroughUpdateId"
  | "baselineId"
  | "baselineSegmentCount"
  | "baselineSegmentIndex"
  | "baselineSegmentsDigest"
>;

/**
 * A stored update's baseline fields as its writer signed them: absent where
 * the column is null. An ordinary update has none.
 */
export function storedBaselineSegmentFields(update: StoredBaselineFields): {
  baselineId?: string;
  baselineSegmentCount?: number;
  baselineSegmentIndex?: number;
  baselineSegmentsDigest?: string;
  coversThroughUpdateId?: string;
} {
  return {
    ...(update.baselineId === null ? {} : { baselineId: update.baselineId }),
    ...(update.baselineSegmentCount === null
      ? {}
      : { baselineSegmentCount: update.baselineSegmentCount }),
    ...(update.baselineSegmentIndex === null
      ? {}
      : { baselineSegmentIndex: update.baselineSegmentIndex }),
    ...(update.baselineSegmentsDigest === null
      ? {}
      : { baselineSegmentsDigest: update.baselineSegmentsDigest }),
    ...(update.baselineCoversThroughUpdateId === null
      ? {}
      : { coversThroughUpdateId: update.baselineCoversThroughUpdateId }),
  };
}

/**
 * The content-record metadata hash a stored update's columns give. It equals
 * the hash in the update's signed write header exactly when no signed field
 * of the row, its baseline fields included, differs from what was signed.
 */
export function storedDocumentUpdateMetadataHash(
  update: StoredBaselineFields &
    Pick<
      DocumentUpdateRecord,
      | "dependencyVersionVector"
      | "documentId"
      | "id"
      | "partialEndVersionVector"
      | "partialStartVersionVector"
      | "plaintextHash"
    >,
): Promise<string> {
  return computeDocumentContentRecordMetadataHash({
    ...storedBaselineSegmentFields(update),
    dependencyVersionVector: update.dependencyVersionVector,
    documentId: update.documentId,
    partialEndVersionVector: update.partialEndVersionVector,
    partialStartVersionVector: update.partialStartVersionVector,
    plaintextHash: update.plaintextHash,
    updateId: update.id,
  });
}

/** A stored baseline that is whole, and where its first segment sits. */
export interface StoredDocumentBaselineGroup extends DocumentBaselineGroup {
  readonly firstSequence: number;
}

async function listStoredBaselineSegments(
  executor: DatabaseSession,
  input: {
    readonly contentKeyEpoch: number;
    readonly documentId: string;
    readonly upperBoundSequence?: number | undefined;
  },
) {
  return executor
    .select({
      baselineCoversThroughUpdateId:
        documentUpdates.baselineCoversThroughUpdateId,
      baselineId: documentUpdates.baselineId,
      baselineSegmentCount: documentUpdates.baselineSegmentCount,
      baselineSegmentIndex: documentUpdates.baselineSegmentIndex,
      baselineSegmentsDigest: documentUpdates.baselineSegmentsDigest,
      dependencyVersionVector: documentUpdates.dependencyVersionVector,
      documentId: documentUpdates.documentId,
      header: documentContentWriteHeaders.header,
      id: documentUpdates.id,
      partialEndVersionVector: documentUpdates.partialEndVersionVector,
      partialStartVersionVector: documentUpdates.partialStartVersionVector,
      plaintextHash: documentUpdates.plaintextHash,
      sequence: documentUpdates.sequence,
    })
    .from(documentUpdates)
    .innerJoin(
      documentContentWriteHeaders,
      eq(documentContentWriteHeaders.updateId, documentUpdates.id),
    )
    .where(
      and(
        eq(documentUpdates.documentId, input.documentId),
        isNotNull(documentUpdates.baselineId),
        eq(documentContentWriteHeaders.contentKeyEpoch, input.contentKeyEpoch),
        ...(input.upperBoundSequence === undefined
          ? []
          : [lte(documentUpdates.sequence, input.upperBoundSequence)]),
      ),
    )
    .orderBy(asc(documentUpdates.sequence));
}

type StoredBaselineSegment = Awaited<
  ReturnType<typeof listStoredBaselineSegments>
>[number];

/**
 * Hold one stored baseline's rows, in commit order, to the rules the group
 * was committed under: each carries the fields its header's metadata hash
 * signs, and together they pass `judgeDocumentBaselineGroup`.
 */
async function judgeStoredBaselineGroup(
  documentId: string,
  rows: readonly StoredBaselineSegment[],
): Promise<StoredDocumentBaselineGroup | null> {
  const first = rows[0];
  if (!first) return null;
  for (const row of rows) {
    if (
      (await storedDocumentUpdateMetadataHash(row)) !== row.header.metadataHash
    ) {
      return null;
    }
  }
  const verdict = await judgeDocumentBaselineGroup({
    documentId,
    segments: rows.map((row) => ({
      baselineId: row.baselineId,
      baselineSegmentCount: row.baselineSegmentCount,
      baselineSegmentIndex: row.baselineSegmentIndex,
      baselineSegmentsDigest: row.baselineSegmentsDigest,
      ciphertextHash: row.header.ciphertextHash,
      coversThroughUpdateId: row.baselineCoversThroughUpdateId,
      dependencyVersionVector: row.dependencyVersionVector,
      metadataHash: row.header.metadataHash,
      partialEndVersionVector: row.partialEndVersionVector,
      partialStartVersionVector: row.partialStartVersionVector,
      updateId: row.id,
    })),
  });
  return verdict.ok
    ? { ...verdict.group, firstSequence: first.sequence }
    : null;
}

/**
 * The latest whole baseline written under `contentKeyEpoch`: of the
 * document's stored baselines at that epoch within the bound, the one
 * committed last whose rows still pass the group rules, or null. One read
 * loads every segment's signed fields, never a payload. A group is committed
 * whole by one transaction, so an honest database never fails the rules; a
 * row altered or removed afterwards, or a group the bound cuts, is skipped
 * instead of redirecting a reader past history it does not carry.
 */
export async function loadLatestStoredDocumentBaselineGroup(
  executor: DatabaseSession,
  input: {
    readonly contentKeyEpoch: number;
    readonly documentId: string;
    readonly upperBoundSequence?: number | undefined;
  },
): Promise<StoredDocumentBaselineGroup | null> {
  const groups = new Map<string, StoredBaselineSegment[]>();
  for (const row of await listStoredBaselineSegments(executor, input)) {
    if (row.baselineId === null) continue;
    const group = groups.get(row.baselineId);
    if (group) group.push(row);
    else groups.set(row.baselineId, [row]);
  }
  // Rows arrive in commit order, so the groups are in the order they began;
  // groups do not interleave, so that is also the order they were sealed.
  for (const rows of [...groups.values()].reverse()) {
    const group = await judgeStoredBaselineGroup(input.documentId, rows);
    if (group) return group;
  }
  return null;
}
