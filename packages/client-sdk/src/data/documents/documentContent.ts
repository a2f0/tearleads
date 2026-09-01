import { LoroMap } from "@tearleads/loro";
import type {
  StructuredDocumentShape as FullStructuredDocumentShape,
  StructuredDocumentMap,
} from "./documentKinds";

export interface DocumentAttachment {
  slotId: string;
  name: string;
  byteLength: number;
  mimeType: string | null;
}

// Attachment helpers only read/write maps, so callers may pass any shape that
// provides `getMap` (a full structured document included).
type StructuredDocumentShape = Pick<FullStructuredDocumentShape, "getMap">;

const DOCUMENT_CONTENT_MAP_KEY = "content";
const ATTACHMENT_KEY_PREFIX = "attachment:";

function isStructuredAttachmentMap(
  value: unknown,
): value is StructuredDocumentMap {
  return (
    typeof value === "object" &&
    value !== null &&
    "entries" in value &&
    typeof value.entries === "function" &&
    "get" in value &&
    typeof value.get === "function" &&
    "set" in value &&
    typeof value.set === "function" &&
    "delete" in value &&
    typeof value.delete === "function"
  );
}

function parseStructuredAttachment(
  slotId: string,
  value: unknown,
): (DocumentAttachment & { order: number | null }) | null {
  if (!isStructuredAttachmentMap(value)) {
    return null;
  }

  const name = value.get("name");
  const byteLength = value.get("byteLength");
  const mimeType = value.get("mimeType");
  const order = value.get("order");

  if (
    typeof name !== "string" ||
    name.length === 0 ||
    typeof byteLength !== "number" ||
    !Number.isInteger(byteLength) ||
    byteLength < 0 ||
    !(
      mimeType === undefined ||
      mimeType === null ||
      typeof mimeType === "string"
    )
  ) {
    return null;
  }

  return {
    byteLength,
    mimeType: mimeType ?? null,
    name,
    order: typeof order === "number" && Number.isFinite(order) ? order : null,
    slotId,
  };
}

export function ensureDocumentAttachmentStructure(
  doc: StructuredDocumentShape,
): void {
  doc.getMap(DOCUMENT_CONTENT_MAP_KEY);
}

function getAttachmentMapKey(slotId: string): string {
  return `${ATTACHMENT_KEY_PREFIX}${slotId}`;
}

function listStructuredDocumentAttachments(
  doc: StructuredDocumentShape,
): Array<DocumentAttachment & { order: number | null }> {
  const documentMap = doc.getMap(DOCUMENT_CONTENT_MAP_KEY);
  return documentMap
    .entries()
    .flatMap(([key, value]) => {
      if (!key.startsWith(ATTACHMENT_KEY_PREFIX)) {
        return [];
      }

      const attachment = parseStructuredAttachment(
        key.slice(ATTACHMENT_KEY_PREFIX.length),
        value,
      );
      return attachment ? [attachment] : [];
    })
    .sort((left, right) => {
      if (left.order !== right.order) {
        if (left.order === null) {
          return 1;
        }

        if (right.order === null) {
          return -1;
        }

        return left.order - right.order;
      }

      return left.slotId.localeCompare(right.slotId);
    });
}

function getStructuredDocumentAttachments(
  doc: StructuredDocumentShape,
): DocumentAttachment[] {
  return listStructuredDocumentAttachments(doc).map(
    ({ order: _order, ...attachment }) => attachment,
  );
}

export function getDocumentAttachments(
  doc: StructuredDocumentShape,
): DocumentAttachment[] {
  return getStructuredDocumentAttachments(doc);
}

export function addDocumentAttachments(
  doc: StructuredDocumentShape,
  attachments: ReadonlyArray<DocumentAttachment>,
): void {
  if (attachments.length === 0) {
    return;
  }

  const documentMap = doc.getMap(DOCUMENT_CONTENT_MAP_KEY);
  const existingAttachments = listStructuredDocumentAttachments(doc);
  let nextOrder =
    existingAttachments.reduce((highestOrder, attachment, index) => {
      return Math.max(highestOrder, attachment.order ?? index);
    }, -1) + 1;

  for (const attachment of attachments) {
    const attachmentMap = documentMap.getOrCreateContainer(
      getAttachmentMapKey(attachment.slotId),
      new LoroMap(),
    );
    attachmentMap.set("name", attachment.name);
    attachmentMap.set("byteLength", attachment.byteLength);
    if (attachment.mimeType === null) {
      attachmentMap.delete("mimeType");
    } else {
      attachmentMap.set("mimeType", attachment.mimeType);
    }
    if (attachmentMap.get("order") === undefined) {
      attachmentMap.set("order", nextOrder);
      nextOrder += 1;
    }
  }
}

export function removeDocumentAttachment(
  doc: StructuredDocumentShape,
  slotId: string,
): void {
  doc.getMap(DOCUMENT_CONTENT_MAP_KEY).delete(getAttachmentMapKey(slotId));
}

export function sameDocumentAttachments(
  left: ReadonlyArray<DocumentAttachment>,
  right: ReadonlyArray<DocumentAttachment>,
): boolean {
  return (
    left.length === right.length &&
    left.every((attachment, index) => {
      const nextAttachment = right[index];
      return (
        nextAttachment !== undefined &&
        attachment.slotId === nextAttachment.slotId &&
        attachment.name === nextAttachment.name &&
        attachment.byteLength === nextAttachment.byteLength &&
        attachment.mimeType === nextAttachment.mimeType
      );
    })
  );
}
