import {
  type BlobBytes,
  type DocumentStore,
  deriveStableDocumentId,
  type Tearleads,
} from "@tearleads/client-sdk";
import { seedDigest } from "./continuityAssets";
import type { SeedDocument } from "./seedDocuments";

interface SeedWriteInput {
  sdk: Tearleads;
  document: SeedDocument;
  containerId: string;
  localId: string;
  existing?: { localId: string; documentId: string } | undefined;
  readAttachment: (name: string) => Promise<BlobBytes>;
}

async function fillSeedAttachment(
  store: DocumentStore,
  input: SeedWriteInput,
  index: number,
  attachment: SeedDocument["attachments"][number],
) {
  const { document, localId } = input;
  const itemId = await deriveStableDocumentId(`${localId}/attachment/${index}`);
  const slotId = attachment.multiple
    ? `${attachment.slot}:${itemId}`
    : (attachment.slot ?? itemId);
  if (store.getSnapshot().attachmentStorageKeyBySlotId[slotId]) return;
  const bytes = await input.readAttachment(attachment.file);
  if (!bytes.length)
    throw new Error(`Empty seed attachment: ${attachment.file}`);
  // Pull the current intent after reading the asset. Other devices can have
  // filled this slot since discovery or while earlier slots were uploading.
  if (input.existing) await refreshSeedDocument(store, document.key);
  const current = store.getSnapshot();
  if (current.attachmentStorageKeyBySlotId[slotId]) return;
  const intent = current.attachments.find((item) => item.slotId === slotId);
  // The document can reach the API before its blob. Repair that slot only
  // when its current intent still describes these exact fixture bytes.
  if (
    intent &&
    (intent.contentSha256 !== seedDigest(bytes) ||
      intent.name !== attachment.file ||
      intent.mimeType !== attachment.mimeType)
  ) {
    throw new Error(`Could not recover edited attachment: ${attachment.file}`);
  }
  await store.replaceAttachment(slotId, {
    bytes,
    name: attachment.file,
    mimeType: attachment.mimeType,
  });
  if (!store.getSnapshot().attachmentStorageKeyBySlotId[slotId]) {
    throw new Error(`Could not save seed attachment: ${attachment.file}`);
  }
}

async function refreshSeedDocument(store: DocumentStore, key: string) {
  if (!(await store.requestRemoteSyncAndWait(AbortSignal.timeout(120_000)))) {
    throw new Error(`Could not load existing ${key}`);
  }
}

/** Birth fields and rows travel together. A retry only fills vacant attachment slots. */
export async function writeContinuityDocument(input: SeedWriteInput) {
  const { sdk, document, containerId, localId, existing } = input;
  const store = sdk.containerContents.documentLinks().openDocument({
    containerId,
    localId: existing?.localId ?? localId,
    documentId: existing?.documentId,
    initialDocumentKind: document.kind,
    initialText: document.text ?? "",
    initialRows: document.rows,
    initialStructuredFields: document.fields,
  });
  if (!(await store.ensureInitialized()))
    throw new Error(`Could not open ${document.key}`);
  if (existing) await refreshSeedDocument(store, document.key);
  const before = store.getSnapshot();
  if (
    !existing &&
    (before.fieldValidationIssues.length ||
      before.rows.length !== (document.rows?.length ?? 0))
  ) {
    throw new Error(`Invalid seed content for ${document.key}`);
  }
  for (const [index, attachment] of document.attachments.entries()) {
    await fillSeedAttachment(store, input, index, attachment);
  }
  return store;
}
