import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import type { BlobWriteAuthorization } from "@symcrypt/api-shared/schema";
import { blobContentWriteHeaders } from "@symcrypt/api-shared/schema";
import type { WriteHeader } from "@symcrypt/crypto";
import { eq, inArray } from "drizzle-orm";
import {
  BlobContentKeyBundleError,
  ensurePositiveContentKeyEpoch,
} from "./blobContentKeyTargets";
import { createContentWriteHeaderStore } from "./contentKeyStore";

interface StoreBlobContentWriteHeaderInput {
  readonly authorization: BlobWriteAuthorization;
  readonly blobId: string;
  readonly header: WriteHeader;
  readonly headerHash: string;
  readonly recordId: string;
}

interface BlobContentWriteHeaderRow {
  readonly authorization: BlobWriteAuthorization | null;
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
      .returning({ headerHash: blobContentWriteHeaders.headerHash });
    return inserted !== undefined;
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
  loadHeaderHash: async (recordId, executor) => {
    const [existing] = await executor
      .select({ headerHash: blobContentWriteHeaders.headerHash })
      .from(blobContentWriteHeaders)
      .where(eq(blobContentWriteHeaders.recordId, recordId))
      .limit(1);
    return existing?.headerHash ?? null;
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
      authorization: BlobWriteAuthorization | null;
      header: WriteHeader;
      headerHash: string;
    }
  >
> {
  return store.list(recordIds, executor);
}
