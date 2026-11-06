import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { documentContentWriteHeaders } from "@tearleads/api-shared/schema";
import type { DocumentContentKeyTarget, WriteHeader } from "@tearleads/crypto";
import { eq, inArray } from "drizzle-orm";
import {
  createContentWriteHeaderStore,
  writeHeaderColumns,
} from "./contentKeyStore";
import { DocumentContentKeyBundleError } from "./documentContentKeyTargets";

interface StoreDocumentContentWriteHeaderInput {
  readonly authorizationTargets: readonly DocumentContentKeyTarget[];
  readonly documentId: string;
  readonly header: WriteHeader;
  readonly headerHash: string;
  readonly updateId: string;
}

interface DocumentContentWriteHeaderRow {
  readonly authorizationTargets: DocumentContentKeyTarget[];
  readonly header: WriteHeader;
  readonly headerHash: string;
  readonly recordId: string;
}

const documentContentWriteHeaderStore = createContentWriteHeaderStore<
  StoreDocumentContentWriteHeaderInput,
  DocumentContentWriteHeaderRow
>({
  createConflictError: () =>
    new DocumentContentKeyBundleError("Document write header conflict", 409),
  createObjectMismatchError: () =>
    new DocumentContentKeyBundleError(
      "Document write header does not match document",
      409,
    ),
  expectedObjectKind: "document",
  getObjectId: (input) => input.documentId,
  getRecordId: (input) => input.updateId,
  insert: async (input, executor) => {
    const [inserted] = await executor
      .insert(documentContentWriteHeaders)
      .values({
        updateId: input.updateId,
        documentId: input.documentId,
        organizationId: input.header.organizationId,
        contentKeyEpoch: input.header.contentKeyEpoch,
        accessManifestHash: input.header.accessManifestHash,
        targetHash: input.header.targetHash,
        encryptionSuite: input.header.encryptionSuite,
        contentRecordId: input.header.contentRecordId,
        nonceDomainHash: input.header.nonceDomainHash,
        headerHash: input.headerHash,
        header: input.header,
        authorizationTargets: [...input.authorizationTargets],
      })
      .onConflictDoNothing()
      .returning(writeHeaderColumns(documentContentWriteHeaders));
    return inserted ?? null;
  },
  list: (updateIds, executor) =>
    executor
      .select({
        recordId: documentContentWriteHeaders.updateId,
        authorizationTargets: documentContentWriteHeaders.authorizationTargets,
        header: documentContentWriteHeaders.header,
        headerHash: documentContentWriteHeaders.headerHash,
      })
      .from(documentContentWriteHeaders)
      .where(inArray(documentContentWriteHeaders.updateId, updateIds)),
  loadStoredHeader: async (updateId, executor) => {
    const [existing] = await executor
      .select(writeHeaderColumns(documentContentWriteHeaders))
      .from(documentContentWriteHeaders)
      .where(eq(documentContentWriteHeaders.updateId, updateId))
      .limit(1);
    return existing ?? null;
  },
});

export async function storeDocumentContentWriteHeader(
  input: StoreDocumentContentWriteHeaderInput,
  executor: DatabaseSession,
): Promise<void> {
  return documentContentWriteHeaderStore.store(input, executor);
}

export async function listDocumentContentWriteHeaders(
  updateIds: readonly string[],
  executor: DatabaseSession,
): Promise<
  Map<
    string,
    {
      authorizationTargets: DocumentContentKeyTarget[];
      header: WriteHeader;
      headerHash: string;
    }
  >
> {
  return documentContentWriteHeaderStore.list(updateIds, executor);
}
