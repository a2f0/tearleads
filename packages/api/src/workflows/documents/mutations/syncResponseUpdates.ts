import { Buffer } from "node:buffer";
import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { documentAuditCheckpoints } from "@tearleads/api-shared/schema";
import {
  computeDocumentContentRecordMetadataHash,
  type DocumentContentKeyTarget,
  type WriteHeader,
} from "@tearleads/crypto";
import {
  MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES,
  MAX_DOCUMENT_SYNC_RESPONSE_UPDATE_PAGE_BYTES,
} from "@tearleads/validators/util";
import { inArray } from "drizzle-orm";
import { listDocumentContentWriteHeaders } from "../../../access/read/documentContentKeyStore";
import { isAuthenticatedReplayableBaseline } from "../../../documents/documentReplayableBaseline";
import {
  listMissingDocumentUpdatePage,
  listMissingDocumentUpdates,
} from "../../../documents/documentUpdateStore";
import { DocumentMutationError } from "./errors";
import { writeHeaderRecord } from "./shared/records";

export interface SyncCheckpointMetadata {
  readonly checkpointKind: "rotate_baseline";
  readonly checkpointPayloadKind: "full_history_snapshot";
  readonly sourceVersionVector: string;
}

interface SyncCheckpointAuthenticationInput {
  readonly checkpoint: SyncCheckpointMetadata | undefined;
  readonly documentId: string;
  readonly metadataHash: string;
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
  readonly plaintextHash: string;
  readonly updateId: string;
}

/**
 * A persisted checkpoint row is an integrity assertion, never an optional
 * response decoration. If its signed metadata no longer authenticates, fail
 * the pull instead of downgrading its snapshot payload to an ordinary update.
 */
export async function authenticateSyncCheckpointForResponse(
  input: SyncCheckpointAuthenticationInput,
): Promise<SyncCheckpointMetadata | undefined> {
  if (input.checkpoint === undefined) {
    const ordinaryMetadataHash = await computeDocumentContentRecordMetadataHash(
      {
        documentId: input.documentId,
        partialEndVersionVector: input.partialEndVersionVector,
        partialStartVersionVector: input.partialStartVersionVector,
        plaintextHash: input.plaintextHash,
        updateId: input.updateId,
      },
    );
    if (input.metadataHash !== ordinaryMetadataHash) {
      throw new DocumentMutationError(
        "Document update metadata failed integrity validation",
        409,
      );
    }
    return undefined;
  }

  const authenticated = await isAuthenticatedReplayableBaseline({
    checkpointKind: input.checkpoint.checkpointKind,
    documentId: input.documentId,
    metadataHash: input.metadataHash,
    partialEndVersionVector: input.partialEndVersionVector,
    partialStartVersionVector: input.partialStartVersionVector,
    plaintextHash: input.plaintextHash,
    sourceVersionVector: input.checkpoint.sourceVersionVector,
    updateId: input.updateId,
  });
  if (!authenticated) {
    throw new DocumentMutationError(
      "Document rotation checkpoint failed integrity validation",
      409,
    );
  }
  return input.checkpoint;
}

async function listSyncCheckpointMetadata(
  executor: DatabaseSession,
  updateIds: readonly string[],
): Promise<ReadonlyMap<string, SyncCheckpointMetadata>> {
  if (updateIds.length === 0) {
    return new Map();
  }
  const rows = await executor
    .select({
      baselineUpdateId: documentAuditCheckpoints.baselineUpdateId,
      checkpointKind: documentAuditCheckpoints.checkpointKind,
      sourceVersionVector: documentAuditCheckpoints.sourceVersionVector,
    })
    .from(documentAuditCheckpoints)
    .where(inArray(documentAuditCheckpoints.baselineUpdateId, updateIds));
  const byUpdateId = new Map<string, SyncCheckpointMetadata>();
  for (const row of rows) {
    if (row.checkpointKind !== "rotate_baseline") {
      throw new DocumentMutationError(
        "Document rotation checkpoint kind is invalid",
        409,
      );
    }
    byUpdateId.set(row.baselineUpdateId, {
      checkpointKind: row.checkpointKind,
      checkpointPayloadKind: "full_history_snapshot",
      sourceVersionVector: row.sourceVersionVector,
    });
  }
  return byUpdateId;
}

function toSyncUpdate(
  update: Awaited<ReturnType<typeof listMissingDocumentUpdates>>[number],
  writeHeader: {
    readonly authorizationTargets: readonly DocumentContentKeyTarget[];
    readonly header: WriteHeader;
    readonly headerHash: string;
  },
  checkpoint: SyncCheckpointMetadata | undefined,
) {
  return {
    accessEpoch: update.accessEpoch,
    ...(checkpoint === undefined
      ? {}
      : {
          checkpointKind: checkpoint.checkpointKind,
          checkpointPayloadKind: checkpoint.checkpointPayloadKind,
        }),
    id: update.id,
    documentId: update.documentId,
    authorFingerprint: update.authorFingerprint,
    encryptedData: update.encryptedData,
    partialStartVersionVector: update.partialStartVersionVector,
    partialEndVersionVector: update.partialEndVersionVector,
    plaintextHash: update.plaintextHash,
    ...(checkpoint === undefined
      ? {}
      : { sourceVersionVector: checkpoint.sourceVersionVector }),
    createdAt: update.createdAt.toISOString(),
    writeHeader: writeHeaderRecord(writeHeader.header),
    authorizationTargets: [...writeHeader.authorizationTargets],
  };
}

export async function materializeSyncResponseEntriesToBytes<
  Item,
  Entry extends {
    readonly sequence: number;
    readonly update: { readonly id: string };
  },
>(
  items: readonly Item[],
  materialize: (item: Item) => Promise<Entry>,
  maxBytes = MAX_DOCUMENT_SYNC_RESPONSE_UPDATE_PAGE_BYTES,
): Promise<Entry[]> {
  const selected: Entry[] = [];
  let serializedBytes = 2; // JSON array brackets.
  for (const item of items) {
    // Materialize one metadata-bearing entry at a time. Write-header
    // authorization targets and checkpoint vectors can each be large, so a
    // bulk load would retain every candidate before this wire bound applies.
    const entry = await materialize(item);
    const serializedEntry = JSON.stringify(entry.update);
    const addedBytes =
      Buffer.byteLength(serializedEntry, "utf8") +
      (selected.length === 0 ? 0 : 1);
    if (serializedBytes + addedBytes > maxBytes) {
      break;
    }
    selected.push(entry);
    serializedBytes += addedBytes;
  }
  if (items.length > 0 && selected.length === 0) {
    throw new DocumentMutationError(
      "Document update exceeds the pull page byte ceiling",
      409,
    );
  }
  return selected;
}

export async function listMissingSyncUpdateEntries(input: {
  readonly documentId: string;
  readonly executor: DatabaseSession;
  readonly localVersionVector: string | null;
  readonly minLsn?: string | undefined;
  readonly pullPage?:
    | {
        readonly afterSequence: number;
        readonly upperBoundSequence: number;
      }
    | undefined;
}) {
  const page = input.pullPage
    ? await listMissingDocumentUpdatePage(input.executor, {
        ...input.pullPage,
        documentId: input.documentId,
        localVersionVector: input.localVersionVector,
        maxSerializedBytes: MAX_DOCUMENT_SYNC_RESPONSE_UPDATE_PAGE_BYTES,
        maxUpdates: MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES,
        minLsn: input.minLsn,
      })
    : undefined;
  const updates = page
    ? page.updates
    : await listMissingDocumentUpdates(input.executor, {
        documentId: input.documentId,
        localVersionVector: input.localVersionVector,
        minLsn: input.minLsn,
      });
  const entries = await materializeSyncResponseEntriesToBytes(
    updates,
    async (update) => {
      const [writeHeadersByUpdateId, checkpointByUpdateId] = await Promise.all([
        listDocumentContentWriteHeaders([update.id], input.executor),
        listSyncCheckpointMetadata(input.executor, [update.id]),
      ]);
      const writeHeader = writeHeadersByUpdateId.get(update.id);
      if (!writeHeader) {
        throw new DocumentMutationError("Document write header missing", 409);
      }
      const checkpoint = await authenticateSyncCheckpointForResponse({
        checkpoint: checkpointByUpdateId.get(update.id),
        documentId: update.documentId,
        metadataHash: writeHeader.header.metadataHash,
        partialEndVersionVector: update.partialEndVersionVector,
        partialStartVersionVector: update.partialStartVersionVector,
        plaintextHash: update.plaintextHash,
        updateId: update.id,
      });

      return {
        sequence: update.sequence,
        update: toSyncUpdate(update, writeHeader, checkpoint),
        writeHeader: writeHeader.header,
      };
    },
  );

  if (page === undefined) return { entries };
  return {
    entries,
    page: {
      hasMore: page.hasMore || entries.length < updates.length,
      lastUpdateId: entries.at(-1)?.update.id ?? page.lastUpdateId,
      lastSequence: entries.at(-1)?.sequence ?? page.lastSequence,
    },
  };
}
