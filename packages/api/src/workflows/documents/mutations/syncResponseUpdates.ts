import { Buffer } from "node:buffer";
import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { DocumentContentKeyTarget, WriteHeader } from "@tearleads/crypto";
import {
  MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES,
  MAX_DOCUMENT_SYNC_RESPONSE_UPDATE_PAGE_BYTES,
} from "@tearleads/validators/util";
import { listDocumentContentWriteHeaders } from "../../../access/read/documentContentKeyStore";
import {
  storedBaselineSegmentFields,
  storedDocumentUpdateMetadataHash,
} from "../../../documents/documentStoredBaselineGroup";
import {
  listMissingDocumentUpdatePage,
  listMissingDocumentUpdates,
} from "../../../documents/documentUpdateStore";
import { DocumentMutationError } from "./errors";
import { writeHeaderRecord } from "./shared/records";

type StoredSyncUpdate = Awaited<
  ReturnType<typeof listMissingDocumentUpdates>
>[number];

/**
 * A stored update's signed fields are an integrity assertion, never an
 * optional response decoration. Its baseline fields ride on its row; if the
 * row no longer gives the metadata hash its header signs, fail the pull
 * instead of serving a baseline segment as an ordinary update or the
 * reverse. Returns the baseline fields the response carries.
 */
export async function authenticateSyncUpdateMetadataForResponse(
  update: Parameters<typeof storedDocumentUpdateMetadataHash>[0],
  metadataHash: string,
): Promise<ReturnType<typeof storedBaselineSegmentFields>> {
  if ((await storedDocumentUpdateMetadataHash(update)) !== metadataHash) {
    throw new DocumentMutationError(
      "Document update metadata failed integrity validation",
      409,
    );
  }
  return storedBaselineSegmentFields(update);
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
  baselineFields: ReturnType<typeof storedBaselineSegmentFields>,
  expectedTargetHash: string,
) {
  return {
    accessEpoch: update.accessEpoch,
    ...baselineFields,
    id: update.id,
    documentId: update.documentId,
    authorFingerprint: update.authorFingerprint,
    encryptedData: update.encryptedData,
    partialStartVersionVector: update.partialStartVersionVector,
    partialEndVersionVector: update.partialEndVersionVector,
    dependencyVersionVector: update.dependencyVersionVector,
    plaintextHash: update.plaintextHash,
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
  const baselineFields = await authenticateSyncUpdateMetadataForResponse(
    update,
    writeHeader.header.metadataHash,
  );

  return {
    sequence: update.sequence,
    update: toSyncUpdate(
      update,
      writeHeader,
      baselineFields,
      expectedTargetHash,
    ),
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
  // write header and authorization targets, so its write headers load as one
  // set. An unpaged listing has no such bound. A baseline segment's group
  // fields ride on its update row.
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
