import { Buffer } from "node:buffer";
import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  computeDocumentContentRecordMetadataHash,
  type DocumentContentKeyTarget,
  type WriteHeader,
} from "@tearleads/crypto";
import {
  MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES,
  MAX_DOCUMENT_SYNC_RESPONSE_UPDATE_PAGE_BYTES,
} from "@tearleads/validators/util";
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
  readonly coversThroughUpdateId?: string | undefined;
  readonly sourceVersionVector: string;
}

interface SyncCheckpointAuthenticationInput {
  readonly checkpoint: SyncCheckpointMetadata | undefined;
  readonly dependencyVersionVector: string;
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
        dependencyVersionVector: input.dependencyVersionVector,
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
    coversThroughUpdateId: input.checkpoint.coversThroughUpdateId,
    dependencyVersionVector: input.dependencyVersionVector,
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

type StoredSyncUpdate = Awaited<
  ReturnType<typeof listMissingDocumentUpdates>
>[number];

/**
 * A rotation baseline's update row carries its declared source version vector;
 * the checkpoint and payload kinds are the rotation constants.
 */
function storedSyncCheckpoint(
  update: StoredSyncUpdate,
): SyncCheckpointMetadata | undefined {
  return update.baselineSourceVersionVector === null
    ? undefined
    : {
        checkpointKind: "rotate_baseline",
        checkpointPayloadKind: "full_history_snapshot",
        ...(update.baselineCoversThroughUpdateId === null
          ? {}
          : { coversThroughUpdateId: update.baselineCoversThroughUpdateId }),
        sourceVersionVector: update.baselineSourceVersionVector,
      };
}

/**
 * The signed header commits to its target set by `targetHash`. When that is
 * the target hash the client said it holds, the set is the one it holds, so
 * the client refills it and re-hashes it against the signed hash.
 */
export function authorizationTargetsUnlessHeld(
  writeHeader: {
    readonly authorizationTargets: readonly DocumentContentKeyTarget[];
    readonly header: WriteHeader;
  },
  expectedTargetHash: string,
) {
  return writeHeader.header.targetHash === expectedTargetHash
    ? {}
    : { authorizationTargets: [...writeHeader.authorizationTargets] };
}

function toSyncUpdate(
  update: StoredSyncUpdate,
  writeHeader: {
    readonly authorizationTargets: readonly DocumentContentKeyTarget[];
    readonly header: WriteHeader;
    readonly headerHash: string;
  },
  checkpoint: SyncCheckpointMetadata | undefined,
  expectedTargetHash: string,
) {
  return {
    accessEpoch: update.accessEpoch,
    ...(checkpoint === undefined
      ? {}
      : {
          checkpointKind: checkpoint.checkpointKind,
          checkpointPayloadKind: checkpoint.checkpointPayloadKind,
          ...(checkpoint.coversThroughUpdateId === undefined
            ? {}
            : { coversThroughUpdateId: checkpoint.coversThroughUpdateId }),
        }),
    id: update.id,
    documentId: update.documentId,
    authorFingerprint: update.authorFingerprint,
    encryptedData: update.encryptedData,
    partialStartVersionVector: update.partialStartVersionVector,
    partialEndVersionVector: update.partialEndVersionVector,
    dependencyVersionVector: update.dependencyVersionVector,
    plaintextHash: update.plaintextHash,
    ...(checkpoint === undefined
      ? {}
      : { sourceVersionVector: checkpoint.sourceVersionVector }),
    createdAt: update.createdAt.toISOString(),
    writeHeader: writeHeaderRecord(writeHeader.header),
    ...authorizationTargetsUnlessHeld(writeHeader, expectedTargetHash),
  };
}

type SyncEntryWriteHeaders = Awaited<
  ReturnType<typeof listDocumentContentWriteHeaders>
>;

async function toSyncResponseEntry(
  update: StoredSyncUpdate,
  writeHeaders: SyncEntryWriteHeaders,
  expectedTargetHash: string,
) {
  const writeHeader = writeHeaders.get(update.id);
  if (!writeHeader) {
    throw new DocumentMutationError("Document write header missing", 409);
  }
  const checkpoint = await authenticateSyncCheckpointForResponse({
    checkpoint: storedSyncCheckpoint(update),
    dependencyVersionVector: update.dependencyVersionVector,
    documentId: update.documentId,
    metadataHash: writeHeader.header.metadataHash,
    partialEndVersionVector: update.partialEndVersionVector,
    partialStartVersionVector: update.partialStartVersionVector,
    plaintextHash: update.plaintextHash,
    updateId: update.id,
  });

  return {
    sequence: update.sequence,
    update: toSyncUpdate(update, writeHeader, checkpoint, expectedTargetHash),
    writeHeader: writeHeader.header,
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
    // Stop at the first entry past the exact wire bound. Callers bound what
    // `materialize` loads: a page preloads metadata for updates that fit their
    // byte floors, and an unpaged listing loads one entry's at a time.
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
  /** The target hash the client holds; matching target sets are omitted. */
  readonly expectedTargetHash: string;
  readonly localVersionVector: string | null;
  /** The client's own page limit; it never raises the server's. */
  readonly maxPageUpdates?: number | undefined;
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
        maxUpdates: Math.min(
          input.maxPageUpdates ?? MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES,
          MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES,
        ),
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
  // A page already fits its response byte floors, which count each entry's
  // write header, authorization targets, and checkpoint, so its write headers
  // load as one set. An unpaged listing has no such bound. Checkpoints ride on
  // the update rows.
  const pageWriteHeaders = page?.writeHeaders;
  const entries = await materializeSyncResponseEntriesToBytes(
    updates,
    async (update) =>
      toSyncResponseEntry(
        update,
        pageWriteHeaders ??
          (await listDocumentContentWriteHeaders([update.id], input.executor)),
        input.expectedTargetHash,
      ),
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
