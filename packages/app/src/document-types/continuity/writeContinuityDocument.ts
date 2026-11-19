import {
  type BlobBytes,
  deriveStableDocumentId,
  type Tearleads,
} from "@tearleads/client-sdk";
import { seedDigest } from "./continuityAssets";
import type { SeedDocument } from "./seedDocuments";
import { uploadVacantAttachments } from "./uploadVacantAttachments";

interface SeedWriteInput {
  destination: "account" | "backup";
  sdk: Tearleads;
  document: SeedDocument;
  containerId: string;
  localId: string;
  existing?: { localId: string; documentId: string } | undefined;
  readAttachment: (name: string) => Promise<BlobBytes>;
}

async function prepareAttachment(input: SeedWriteInput, index: number) {
  const attachment = input.document.attachments[index];
  if (!attachment) throw new Error("Missing fixture attachment");
  const itemId = await deriveStableDocumentId(
    `${input.localId}/attachment/${index}`,
  );
  const slotId = attachment.multiple
    ? `${attachment.slot}:${itemId}`
    : (attachment.slot ?? itemId);
  const bytes = await input.readAttachment(attachment.file);
  if (!bytes.length)
    throw new Error(`Empty seed attachment: ${attachment.file}`);
  return {
    bytes,
    intent: {
      name: attachment.file,
      mimeType: attachment.mimeType,
      slotId,
      byteLength: bytes.length,
      contentSha256: seedDigest(bytes),
    },
  };
}

export async function writeContinuityDocument(input: SeedWriteInput) {
  const { sdk, document, existing } = input;
  const attachments = await Promise.all(
    document.attachments.map((_, index) => prepareAttachment(input, index)),
  );
  const store = sdk.containerContents.documentLinks().openDocument({
    containerId: input.containerId,
    localId: existing?.localId ?? input.localId,
    documentId: existing?.documentId,
    initialDocumentKind: document.kind,
    initialText: document.text ?? "",
    initialRows: document.rows,
    initialStructuredFields: document.fields,
    initialAttachments: attachments.map(({ intent }) => intent),
  });
  if (!(await store.ensureInitialized()))
    throw new Error(`Could not open ${document.key}`);
  const before = store.getSnapshot();
  if (
    !existing &&
    (before.fieldValidationIssues.length ||
      before.rows.length !== (document.rows?.length ?? 0))
  ) {
    throw new Error(`Invalid seed content for ${document.key}`);
  }
  if (input.destination === "account") {
    await uploadVacantAttachments(input, store, attachments);
  } else {
    for (const { bytes, intent } of attachments) {
      await store.replaceAttachment(intent.slotId, {
        bytes,
        name: intent.name,
        mimeType: intent.mimeType,
      });
      if (!store.getSnapshot().attachmentStorageKeyBySlotId[intent.slotId])
        throw new Error(`Could not save seed attachment: ${intent.name}`);
    }
  }
  return store;
}
