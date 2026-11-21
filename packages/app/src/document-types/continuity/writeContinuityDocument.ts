import {
  type BlobBytes,
  deriveStableDocumentId,
  type Tearleads,
} from "@tearleads/client-sdk";
import { seedDigest } from "./continuityAssets";
import { captureContinuityScope } from "./continuityScope";
import type { SeedDocument } from "./seedDocuments";
import { uploadVacantAttachments } from "./uploadVacantAttachments";

interface SeedWriteBase {
  sdk: Tearleads;
  document: SeedDocument;
  containerId: string;
  localId: string;
  readAttachment: (name: string) => Promise<BlobBytes>;
}

type SeedWriteInput = SeedWriteBase &
  (
    | { destination: "backup"; existing?: never }
    | {
        destination: "account";
        traceAttachment?: (event: string) => void;
        onRecoveredStaleTarget?: (() => void) | undefined;
        existing?: { localId: string; documentId: string } | undefined;
      }
  );

async function prepareAttachment(
  input: Pick<SeedWriteBase, "localId" | "document" | "readAttachment">,
  index: number,
) {
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

export function prepareContinuityAttachments(
  input: Pick<SeedWriteBase, "localId" | "document" | "readAttachment">,
) {
  return Promise.all(
    input.document.attachments.map((_, index) =>
      prepareAttachment(input, index),
    ),
  );
}

export function continuitySeedTag(
  document: SeedDocument,
  attachments: Awaited<ReturnType<typeof prepareContinuityAttachments>>,
) {
  return seedDigest(
    JSON.stringify([document, attachments.map(({ intent }) => intent)]),
  );
}

async function openContinuityDocument(
  input: SeedWriteInput,
  attachments: ReadonlyArray<Awaited<ReturnType<typeof prepareAttachment>>>,
  assertCurrent: () => void,
  seedTag: string | undefined,
) {
  const { sdk, document } = input;
  const content = {
    initialDocumentKind: document.kind,
    initialText: document.text ?? "",
    initialRows: document.rows,
    initialStructuredFields: document.fields,
  };
  const links = sdk.containerContents.documentLinks();
  let placement = input.destination === "account" ? input.existing : undefined;
  if (input.destination === "account" && !placement) {
    const documentId = await deriveStableDocumentId(input.localId);
    assertCurrent();
    const receipt = await sdk.documents.createSeeded({
      ...content,
      onRecoveredStaleTarget: input.onRecoveredStaleTarget,
      seedTag,
      initialAttachments: attachments.map(({ intent }) => intent),
      containerId: input.containerId,
      documentId,
    });
    assertCurrent();
    if (receipt === "purged") return receipt;
    const [summary] = await sdk.containerContents
      .documentQueries()
      .upsertDiscoveredDocuments([receipt], assertCurrent);
    if (!summary || summary.documentId !== receipt.documentId)
      throw new Error("Missing seeded document placement.");
    placement = { localId: summary.id, documentId: receipt.documentId };
  }
  assertCurrent();
  return links.openDocument({
    containerId: input.containerId,
    localId: placement?.localId ?? input.localId,
    ...(placement ? { documentId: placement.documentId } : content),
  });
}

export async function writeContinuityDocument(input: SeedWriteInput) {
  const { document } = input;
  const { stillCurrent, assertCurrent } = captureContinuityScope(input.sdk);
  const attachments = await prepareContinuityAttachments(input);
  assertCurrent();
  const seedTag = continuitySeedTag(document, attachments);
  const store = await openContinuityDocument(
    input,
    attachments,
    assertCurrent,
    seedTag,
  );
  if (store === "purged") return store;
  if (!(await store.ensureInitialized()))
    throw new Error(`Could not open ${document.key}`);
  assertCurrent();
  const before = store.getSnapshot();
  if (
    input.destination === "backup" &&
    (before.fieldValidationIssues.length ||
      before.rows.length !== (document.rows?.length ?? 0))
  ) {
    throw new Error(`Invalid seed content for ${document.key}`);
  }
  if (input.destination === "account") {
    await uploadVacantAttachments(
      input,
      store,
      attachments,
      stillCurrent,
      seedTag,
    );
  } else {
    for (const { bytes, intent } of attachments) {
      assertCurrent();
      await store.replaceAttachment(intent.slotId, {
        bytes,
        name: intent.name,
        mimeType: intent.mimeType,
      });
      if (!store.getSnapshot().attachmentStorageKeyBySlotId[intent.slotId])
        throw new Error(`Could not save seed attachment: ${intent.name}`);
    }
  }
  assertCurrent();
  return store;
}
