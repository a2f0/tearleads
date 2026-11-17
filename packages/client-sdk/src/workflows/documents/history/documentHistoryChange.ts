import type { DocumentAttachment } from "../../../data/documents/documentContent";
import type { StoredDocumentKind } from "../../../data/documents/documentKinds";
import type { DocumentRow } from "../../../data/documents/documentRowList";

/** The parts of a document that its history can change. */
export interface DocumentHistoryContent {
  readonly attachments: ReadonlyArray<DocumentAttachment>;
  readonly documentKind: StoredDocumentKind;
  readonly rows: ReadonlyArray<DocumentRow>;
  readonly structuredFields: Readonly<Record<string, string>>;
  readonly text: string;
}

/**
 * The one region of text that differs between two versions, in UTF-16 units
 * of the newer text. Edits in several places are reported as the single region
 * that spans them.
 */
export interface DocumentHistoryTextChange {
  /** Where the region starts, in both the older and the newer text. */
  readonly start: number;
  /** Length of the region in the newer text. */
  readonly insertedLength: number;
  /** Length of the region it replaced in the older text. */
  readonly removedLength: number;
}

export interface DocumentHistoryRowChange {
  readonly id: string;
  /** Cells whose value was set, changed, or cleared, in key order. */
  readonly fields: ReadonlyArray<string>;
}

/** What one step of history changed, compared with the step before it. */
export interface DocumentHistoryChange {
  readonly attachments: {
    readonly added: ReadonlyArray<string>;
    readonly removed: ReadonlyArray<string>;
    /** Slots that kept their place but now hold different bytes or a new name. */
    readonly replaced: ReadonlyArray<string>;
  };
  /** Structured fields set, changed, or cleared, in key order. */
  readonly fields: ReadonlyArray<string>;
  readonly kindChanged: boolean;
  readonly rows: {
    readonly added: ReadonlyArray<string>;
    readonly changed: ReadonlyArray<DocumentHistoryRowChange>;
    readonly removed: ReadonlyArray<string>;
  };
  readonly text: DocumentHistoryTextChange | null;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function compareTextChange(
  before: string,
  after: string,
): DocumentHistoryTextChange | null {
  if (before === after) return null;
  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (
    start < shorter &&
    before.charCodeAt(start) === after.charCodeAt(start)
  ) {
    start += 1;
  }
  // Keep a shared high surrogate with the differing low surrogate after it.
  if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) start -= 1;
  let shared = 0;
  while (
    shared < shorter - start &&
    before.charCodeAt(before.length - 1 - shared) ===
      after.charCodeAt(after.length - 1 - shared)
  ) {
    shared += 1;
  }
  // Keep a shared low surrogate with the differing high surrogate before it.
  if (shared > 0 && isLowSurrogate(before.charCodeAt(before.length - shared))) {
    shared -= 1;
  }
  return {
    start,
    insertedLength: after.length - shared - start,
    removedLength: before.length - shared - start,
  };
}

function changedKeys(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => before[key] !== after[key]).sort();
}

function compareRows(
  before: ReadonlyArray<DocumentRow>,
  after: ReadonlyArray<DocumentRow>,
): DocumentHistoryChange["rows"] {
  const beforeById = new Map(before.map((row) => [row.id, row]));
  const afterIds = new Set(after.map((row) => row.id));
  const added: string[] = [];
  const changed: DocumentHistoryRowChange[] = [];
  for (const row of after) {
    const previous = beforeById.get(row.id);
    if (previous === undefined) {
      added.push(row.id);
      continue;
    }
    const fields = changedKeys(previous.fields, row.fields);
    if (fields.length > 0) changed.push({ id: row.id, fields });
  }
  return {
    added,
    changed,
    removed: before.filter((row) => !afterIds.has(row.id)).map((row) => row.id),
  };
}

function sameAttachment(
  left: DocumentAttachment,
  right: DocumentAttachment,
): boolean {
  return (
    left.contentSha256 === right.contentSha256 &&
    left.name === right.name &&
    left.byteLength === right.byteLength &&
    left.mimeType === right.mimeType
  );
}

function compareAttachments(
  before: ReadonlyArray<DocumentAttachment>,
  after: ReadonlyArray<DocumentAttachment>,
): DocumentHistoryChange["attachments"] {
  const beforeBySlot = new Map(before.map((item) => [item.slotId, item]));
  const afterSlots = new Set(after.map((item) => item.slotId));
  const added: string[] = [];
  const replaced: string[] = [];
  for (const attachment of after) {
    const previous = beforeBySlot.get(attachment.slotId);
    if (previous === undefined) {
      added.push(attachment.slotId);
    } else if (!sameAttachment(previous, attachment)) {
      replaced.push(attachment.slotId);
    }
  }
  return {
    added,
    removed: before
      .filter((item) => !afterSlots.has(item.slotId))
      .map((item) => item.slotId),
    replaced,
  };
}

/** Compare a version with the one before it. Pure. */
export function compareDocumentHistoryContent(
  before: DocumentHistoryContent,
  after: DocumentHistoryContent,
): DocumentHistoryChange {
  return {
    attachments: compareAttachments(before.attachments, after.attachments),
    fields: changedKeys(before.structuredFields, after.structuredFields),
    kindChanged: before.documentKind !== after.documentKind,
    rows: compareRows(before.rows, after.rows),
    text: compareTextChange(before.text, after.text),
  };
}

/** Whether a step changed anything a reader of the document would see. */
export function isEmptyDocumentHistoryChange(
  change: DocumentHistoryChange,
): boolean {
  return (
    !change.kindChanged &&
    change.text === null &&
    change.fields.length === 0 &&
    change.rows.added.length === 0 &&
    change.rows.changed.length === 0 &&
    change.rows.removed.length === 0 &&
    change.attachments.added.length === 0 &&
    change.attachments.removed.length === 0 &&
    change.attachments.replaced.length === 0
  );
}
