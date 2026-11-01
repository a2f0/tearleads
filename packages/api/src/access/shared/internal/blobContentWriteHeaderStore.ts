import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { BlobWriteAuthorization } from "@tearleads/api-shared/schema";
import { blobContentWriteHeaders } from "@tearleads/api-shared/schema";
import type { WriteHeader } from "@tearleads/crypto";
import { eq, inArray } from "drizzle-orm";
import {
  BlobContentKeyBundleError,
  ensurePositiveContentKeyEpoch,
} from "./blobContentKeyTargets";
import {
  createContentWriteHeaderStore,
  writeHeaderColumns,
} from "./contentKeyStore";

interface StoreBlobContentWriteHeaderInput {
  readonly authorization: BlobWriteAuthorization;
  readonly blobId: string;
  readonly header: WriteHeader;
  readonly headerHash: string;
  readonly recordId: string;
}

interface BlobContentWriteHeaderRow {
  readonly authorization: BlobWriteAuthorization;
  readonly header: WriteHeader;
  readonly headerHash: string;
  readonly recordId: string;
}

const store = createContentWriteHeaderStore<
  StoreBlobContentWriteHeaderInput,
  BlobContentWriteHeaderRow
>({
  createConflictError: () =>
    new BlobContentKeyBundleError("Blob write header conflict", 409),
  createObjectMismatchError: () =>
    new BlobContentKeyBundleError("Blob write header does not match blob", 409),
  ensureContentKeyEpoch: ensurePositiveContentKeyEpoch,
  expectedObjectKind: "blob",
  getObjectId: (input) => input.blobId,
  getRecordId: (input) => input.recordId,
  insert: async (input, executor) => {
    const [inserted] = await executor
      .insert(blobContentWriteHeaders)
      .values({
        accessManifestHash: input.header.accessManifestHash,
        authorization: input.authorization,
        blobId: input.blobId,
        contentKeyEpoch: input.header.contentKeyEpoch,
        contentRecordId: input.header.contentRecordId,
        encryptionSuite: input.header.encryptionSuite,
        header: input.header,
        headerHash: input.headerHash,
        nonceDomainHash: input.header.nonceDomainHash,
        organizationId: input.header.organizationId,
        recordId: input.recordId,
        targetHash: input.header.targetHash,
      })
      .onConflictDoNothing()
      .returning(writeHeaderColumns(blobContentWriteHeaders));
    return inserted ?? null;
  },
  list: (recordIds, executor) =>
    executor
      .select({
        authorization: blobContentWriteHeaders.authorization,
        header: blobContentWriteHeaders.header,
        headerHash: blobContentWriteHeaders.headerHash,
        recordId: blobContentWriteHeaders.recordId,
      })
      .from(blobContentWriteHeaders)
      .where(inArray(blobContentWriteHeaders.recordId, recordIds)),
  loadStoredHeader: async (recordId, executor) => {
    const [existing] = await executor
      .select(writeHeaderColumns(blobContentWriteHeaders))
      .from(blobContentWriteHeaders)
      .where(eq(blobContentWriteHeaders.recordId, recordId))
      .limit(1);
    return existing ?? null;
  },
});

export async function storeBlobContentWriteHeader(
  input: StoreBlobContentWriteHeaderInput,
  executor: DatabaseSession,
): Promise<void> {
  return store.store(input, executor);
}

export async function listBlobContentWriteHeaders(
  recordIds: readonly string[],
  executor: DatabaseSession,
): Promise<
  Map<
    string,
    {
      authorization: BlobWriteAuthorization;
      header: WriteHeader;
      headerHash: string;
    }
  >
> {
  return store.list(recordIds, executor);
}
