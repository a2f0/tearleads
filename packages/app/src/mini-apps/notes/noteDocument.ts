export interface NoteAttachment {
  slotId: string;
  name: string;
  byteLength: number;
  mimeType: string | null;
}

interface NoteDocumentMap {
  get: (key: string) => unknown;
  set: (key: string, value: string) => void;
  delete: (key: string) => void;
}

interface NoteDocumentShape {
  getMap: (key: string) => NoteDocumentMap;
}

const NOTE_MAP_KEY = "note";
const ATTACHMENTS_KEY = "attachments";

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

export function getNoteAttachments(doc: NoteDocumentShape): NoteAttachment[] {
  return parseNoteAttachments(doc.getMap(NOTE_MAP_KEY).get(ATTACHMENTS_KEY));
}

export function setNoteAttachments(
  doc: NoteDocumentShape,
  attachments: ReadonlyArray<NoteAttachment>,
): void {
  const noteMap = doc.getMap(NOTE_MAP_KEY);

  if (attachments.length === 0) {
    noteMap.delete(ATTACHMENTS_KEY);
    return;
  }

  noteMap.set(ATTACHMENTS_KEY, JSON.stringify(attachments));
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
