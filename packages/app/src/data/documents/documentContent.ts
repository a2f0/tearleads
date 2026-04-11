import { LoroMap } from "@tearleads/loro";

export interface DocumentAttachment {
  slotId: string;
  name: string;
  byteLength: number;
  mimeType: string | null;
}

interface NoteDocumentMap {
  entries: () => Array<[string, unknown]>;
  getOrCreateContainer: (
    key: string,
    container: LoroMap<Record<string, unknown>>,
  ) => NoteDocumentMap;
  get: (key: string) => unknown;
  set: (key: string, value: string | number) => void;
  delete: (key: string) => void;
}

interface NoteDocumentShape {
  getMap: (key: string) => NoteDocumentMap;
}

const NOTE_MAP_KEY = "note";
const ATTACHMENT_KEY_PREFIX = "attachment:";

function isNoteAttachmentMap(value: unknown): value is NoteDocumentMap {
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
  if (!isNoteAttachmentMap(value)) {
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
  doc: NoteDocumentShape,
): void {
  doc.getMap(NOTE_MAP_KEY);
}

function getAttachmentMapKey(slotId: string): string {
  return `${ATTACHMENT_KEY_PREFIX}${slotId}`;
}

function getStructuredNoteAttachments(
  doc: NoteDocumentShape,
): DocumentAttachment[] {
  const noteMap = doc.getMap(NOTE_MAP_KEY);
  const attachments = noteMap
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

  return attachments.map(({ order: _order, ...attachment }) => attachment);
}

export function getDocumentAttachments(
  doc: NoteDocumentShape,
): DocumentAttachment[] {
  return getStructuredNoteAttachments(doc);
}

export function addDocumentAttachments(
  doc: NoteDocumentShape,
  attachments: ReadonlyArray<DocumentAttachment>,
): void {
  if (attachments.length === 0) {
    return;
  }

  const noteMap = doc.getMap(NOTE_MAP_KEY);
  const existingAttachments = getStructuredNoteAttachments(doc);
  let nextOrder =
    existingAttachments.reduce((highestOrder, _attachment, index) => {
      return Math.max(highestOrder, index);
    }, -1) + 1;

  for (const attachment of attachments) {
    const attachmentMap = noteMap.getOrCreateContainer(
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
