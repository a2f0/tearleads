import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  documentContentKeyEpochs,
  documentContentKeyTargets,
} from "@tearleads/api-shared/schema";
import { and, desc, eq } from "drizzle-orm";
import {
  type DocumentContentKeyTargetEnvelope,
  type StoredDocumentContentKeyBundle,
  sortTargetEnvelopes,
} from "./documentContentKeyTargets";

export async function loadDocumentContentKeyEpochRow(
  documentId: string,
  contentKeyEpoch: number,
  executor: DatabaseSession,
) {
  const [row] = await executor
    .select()
    .from(documentContentKeyEpochs)
    .where(
      and(
        eq(documentContentKeyEpochs.documentId, documentId),
        eq(documentContentKeyEpochs.contentKeyEpoch, contentKeyEpoch),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function loadLatestDocumentContentKeyEpochRow(
  documentId: string,
  executor: DatabaseSession,
) {
  const [row] = await executor
    .select()
    .from(documentContentKeyEpochs)
    .where(eq(documentContentKeyEpochs.documentId, documentId))
    .orderBy(desc(documentContentKeyEpochs.contentKeyEpoch))
    .limit(1);

  return row ?? null;
}

export async function loadDocumentContentKeyBundle(
  documentId: string,
  contentKeyEpoch: number,
  executor: DatabaseSession,
): Promise<StoredDocumentContentKeyBundle | null> {
  const rows = await executor
    .select({
      epoch: documentContentKeyEpochs,
      target: {
        containerId: documentContentKeyTargets.containerId,
        containerManifestHash: documentContentKeyTargets.containerManifestHash,
        containerKeyEpochId: documentContentKeyTargets.containerKeyEpochId,
        containerKeyEpoch: documentContentKeyTargets.containerKeyEpoch,
        wrappedKey: documentContentKeyTargets.wrappedKey,
        wrappingMetadata: documentContentKeyTargets.wrappingMetadata,
      },
    })
    .from(documentContentKeyEpochs)
    .leftJoin(
      documentContentKeyTargets,
      eq(
        documentContentKeyTargets.documentContentKeyEpochId,
        documentContentKeyEpochs.id,
      ),
    )
    .where(
      and(
        eq(documentContentKeyEpochs.documentId, documentId),
        eq(documentContentKeyEpochs.contentKeyEpoch, contentKeyEpoch),
      ),
    );
  const row = rows[0]?.epoch;
  if (!row) return null;
  return {
    documentId: row.documentId,
    contentKeyEpoch: row.contentKeyEpoch,
    linkSetManifestHash: row.linkSetManifestHash,
    targetHash: row.targetHash,
    targets: sortTargetEnvelopes(
      rows.flatMap(({ target }) => (target ? [target] : [])),
    ),
  };
}

async function listDocumentContentKeyTargetRows(
  documentContentKeyEpochId: string,
  executor: DatabaseSession,
): Promise<DocumentContentKeyTargetEnvelope[]> {
  const rows = await executor
    .select({
      containerId: documentContentKeyTargets.containerId,
      containerManifestHash: documentContentKeyTargets.containerManifestHash,
      containerKeyEpochId: documentContentKeyTargets.containerKeyEpochId,
      containerKeyEpoch: documentContentKeyTargets.containerKeyEpoch,
      wrappedKey: documentContentKeyTargets.wrappedKey,
      wrappingMetadata: documentContentKeyTargets.wrappingMetadata,
    })
    .from(documentContentKeyTargets)
    .where(
      eq(
        documentContentKeyTargets.documentContentKeyEpochId,
        documentContentKeyEpochId,
      ),
    );

  return sortTargetEnvelopes(rows);
}

export async function toStoredBundle(
  row: typeof documentContentKeyEpochs.$inferSelect,
  executor: DatabaseSession,
): Promise<StoredDocumentContentKeyBundle> {
  return {
    documentId: row.documentId,
    contentKeyEpoch: row.contentKeyEpoch,
    linkSetManifestHash: row.linkSetManifestHash,
    targetHash: row.targetHash,
    targets: await listDocumentContentKeyTargetRows(row.id, executor),
  };
}
