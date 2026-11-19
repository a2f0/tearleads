import {
  type BlobBytes,
  type DocumentStore,
  deriveStableDocumentId,
  resolveDocumentCreateAuthor,
  type Tearleads,
} from "@tearleads/client-sdk";
import { seedDigest } from "./continuityAssets";
import type { SeedDocument } from "./seedDocuments";

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

async function uploadVacantAttachments(
  input: SeedWriteInput,
  store: DocumentStore,
  attachments: Awaited<ReturnType<typeof prepareAttachment>>[],
) {
  if (!(await store.requestRemoteSyncAndWait(AbortSignal.timeout(120_000)))) {
    throw new Error(`Could not sync ${input.document.key}`);
  }
  const current = store.getSnapshot();
  const links = input.sdk.containerContents.documentLinks();
  const runtime = links.documentRuntime(input.containerId);
  const author = resolveDocumentCreateAuthor(runtime);
  if (!current.documentId || !author)
    throw new Error("Missing seed document or writer");
  for (const { bytes, intent } of attachments) {
    if (current.attachmentStorageKeyBySlotId[intent.slotId]) continue;
    const recorded = current.attachments.find(
      (item) => item.slotId === intent.slotId,
    );
    // All fixture intents were committed in the birth. A missing intent now
    // means the user removed the attachment.
    if (!recorded) continue;
    if (
      recorded.contentSha256 !== intent.contentSha256 ||
      recorded.name !== intent.name ||
      recorded.mimeType !== intent.mimeType ||
      recorded.byteLength !== intent.byteLength
    ) {
      throw new Error(`Could not recover edited attachment: ${intent.name}`);
    }
    // Do not enqueue a document edit on retry. The API compares the expected
    // binding during commit even when another device writes after our pull.
    const result = await runtime.blobAttachments.uploadDocumentAttachment({
      author,
      bytes,
      documentId: current.documentId,
      slotId: intent.slotId,
      expectedBindingId: null,
      resolveProjectionUserKey: links.resolveProjectionUserKey,
      warmReferencedPrincipalPolicies: runtime.principalPolicies.createWarmer(),
    });
    if (!result)
      throw new Error(
        `Could not upload seed attachment: ${intent.name}. Run seed again to resume.`,
      );
  }
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
