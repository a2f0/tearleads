import {
  type BlobBytes,
  deriveStableDocumentId,
  type Tearleads,
} from "@tearleads/client-sdk";
import { AVATAR_PHOTO_FIELD } from "../shared/documentPhotos";
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

interface SeedWriteInput extends SeedWriteBase {
  traceAttachment?: (event: string) => void;
  onRecoveredStaleTarget?: (() => void) | undefined;
  onRefusedStaleBind?: (() => void) | undefined;
  existing?: { localId: string; documentId: string } | undefined;
}

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

/**
 * The fixture as it is written: a photo marked as the avatar gets its slot
 * only when prepared, so the avatar field that selects it is set then too.
 */
export function withContinuityAvatar(
  document: SeedDocument,
  attachments: Awaited<ReturnType<typeof prepareContinuityAttachments>>,
): SeedDocument {
  const index = document.attachments.findIndex(({ avatar }) => avatar);
  const slotId = attachments[index]?.intent.slotId;
  if (!slotId) return document;
  return {
    ...document,
    fields: { ...document.fields, [AVATAR_PHOTO_FIELD]: slotId },
  };
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
  let placement = input.existing;
  if (!placement) {
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
    localId: placement.localId,
    documentId: placement.documentId,
  });
}

export async function writeContinuityDocument(fixture: SeedWriteInput) {
  const { stillCurrent, assertCurrent } = captureContinuityScope(fixture.sdk);
  const attachments = await prepareContinuityAttachments(fixture);
  assertCurrent();
  const document = withContinuityAvatar(fixture.document, attachments);
  const input = { ...fixture, document };
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
  await uploadVacantAttachments(
    input,
    store,
    attachments,
    stillCurrent,
    seedTag,
  );
  assertCurrent();
  return store;
}
