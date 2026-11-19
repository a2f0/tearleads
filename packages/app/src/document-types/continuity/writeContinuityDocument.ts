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

async function fillSeedAttachments(
  store: DocumentStore,
  input: SeedWriteInput,
) {
  const { document, localId } = input;
  const before = store.getSnapshot();
  for (const [index, attachment] of document.attachments.entries()) {
    const itemId = await deriveStableDocumentId(
      `${localId}/attachment/${index}`,
    );
    const slotId = attachment.multiple
      ? `${attachment.slot}:${itemId}`
      : (attachment.slot ?? itemId);
    if (before.attachmentStorageKeyBySlotId[slotId]) continue;
    const intent = before.attachments.find((item) => item.slotId === slotId);
    const bytes = await input.readAttachment(attachment.file);
    if (!bytes.length)
      throw new Error(`Empty seed attachment: ${attachment.file}`);
    // The document can reach the API before its blob. Repair that slot only
    // when its current intent still describes these exact fixture bytes.
    if (
      intent &&
      (intent.contentSha256 !== seedDigest(bytes) ||
        intent.name !== attachment.file ||
        intent.mimeType !== attachment.mimeType)
    ) {
      throw new Error(
        `Could not recover edited attachment: ${attachment.file}`,
      );
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
  if (
    existing &&
    !(await store.requestRemoteSyncAndWait(AbortSignal.timeout(120_000)))
  ) {
    throw new Error(`Could not load existing ${document.key}`);
  }
  const before = store.getSnapshot();
  if (
    !existing &&
    (before.fieldValidationIssues.length ||
      before.rows.length !== (document.rows?.length ?? 0))
  ) {
    throw new Error(`Invalid seed content for ${document.key}`);
  }
  await fillSeedAttachments(store, input);
  return store;
}
