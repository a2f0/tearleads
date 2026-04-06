import { LoroMap } from "@tearleads/loro";

export interface NoteAttachment {
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
const LEGACY_ATTACHMENTS_KEY = "attachments";
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

function isNoteAttachment(value: unknown): value is NoteAttachment {
  return (
    typeof value === "object" &&
    value !== null &&
    "slotId" in value &&
    typeof value.slotId === "string" &&
    value.slotId.length > 0 &&
    "name" in value &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    "byteLength" in value &&
    typeof value.byteLength === "number" &&
    Number.isInteger(value.byteLength) &&
    value.byteLength >= 0 &&
    "mimeType" in value &&
    (value.mimeType === null || typeof value.mimeType === "string")
  );
}

function parseNoteAttachments(value: unknown): NoteAttachment[] {
  if (typeof value !== "string" || value.length === 0) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isNoteAttachment) : [];
  } catch {
    return [];
  }
}

function parseStructuredAttachment(
  slotId: string,
  value: unknown,
): (NoteAttachment & { order: number | null }) | null {
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

export function ensureNoteAttachmentStructure(doc: NoteDocumentShape): void {
  doc.getMap(NOTE_MAP_KEY);
}

function getAttachmentMapKey(slotId: string): string {
  return `${ATTACHMENT_KEY_PREFIX}${slotId}`;
}

function migrateLegacyAttachments(doc: NoteDocumentShape): void {
  const noteMap = doc.getMap(NOTE_MAP_KEY);
  const legacyAttachments = parseNoteAttachments(
    noteMap.get(LEGACY_ATTACHMENTS_KEY),
  );

  if (legacyAttachments.length === 0) {
    return;
  }

  addNoteAttachments(doc, legacyAttachments);
  noteMap.delete(LEGACY_ATTACHMENTS_KEY);
}

function getStructuredNoteAttachments(
  doc: NoteDocumentShape,
): NoteAttachment[] {
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

export function getNoteAttachments(doc: NoteDocumentShape): NoteAttachment[] {
  const structuredAttachments = getStructuredNoteAttachments(doc);
  if (structuredAttachments.length > 0) {
    return structuredAttachments;
  }

  return parseNoteAttachments(
    doc.getMap(NOTE_MAP_KEY).get(LEGACY_ATTACHMENTS_KEY),
  );
}

export function addNoteAttachments(
  doc: NoteDocumentShape,
  attachments: ReadonlyArray<NoteAttachment>,
): void {
  if (attachments.length === 0) {
    return;
  }

  migrateLegacyAttachments(doc);
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

export function sameNoteAttachments(
  left: ReadonlyArray<NoteAttachment>,
  right: ReadonlyArray<NoteAttachment>,
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
