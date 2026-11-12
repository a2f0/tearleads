import type { DocumentRow } from "@tearleads/client-sdk";
import { sameContactAvatarRef } from "../../document-types/contact/contactAvatarSlot";
import type { ContactEntry } from "../../document-types/contact/contactDocumentModel";

const contactCollator = new Intl.Collator(undefined, { sensitivity: "base" });

function compareContactText(left: string, right: string): number {
  return contactCollator.compare(left, right);
}

function compareNullableContactText(
  left: string | null,
  right: string | null,
): number {
  return compareContactText(left ?? "", right ?? "");
}

function getContactSortName(entry: ContactEntry): string {
  const nickname = (entry.nickname ?? "").trim();
  if (nickname.length > 0) {
    return nickname;
  }

  return `${entry.lastName.trim()} ${entry.firstName.trim()}`.trim();
}

export function sortContactEntries(
  entries: ReadonlyArray<ContactEntry>,
): ContactEntry[] {
  return [...entries].sort((left, right) => {
    return (
      compareContactText(getContactSortName(left), getContactSortName(right)) ||
      compareContactText(left.lastName, right.lastName) ||
      compareContactText(left.firstName, right.firstName) ||
      compareNullableContactText(left.userId, right.userId) ||
      compareContactText(left.id, right.id)
    );
  });
}

function sameRowRecord<T>(
  left: Record<string, T>,
  right: Record<string, T>,
): boolean {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && left[key] === right[key])
  );
}

function sameContactRows(
  left: ReadonlyArray<DocumentRow> | undefined,
  right: ReadonlyArray<DocumentRow> | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((row, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      row.id === other.id &&
      row.createdBy === other.createdBy &&
      row.createdAt === other.createdAt &&
      row.updatedBy === other.updatedBy &&
      row.updatedAt === other.updatedAt &&
      row.createdByPeer === other.createdByPeer &&
      row.updatedByPeer === other.updatedByPeer &&
      sameRowRecord(row.fields, other.fields) &&
      sameRowRecord(row.fieldEditors, other.fieldEditors)
    );
  });
}

export function sameContactEntry(
  left: ContactEntry,
  right: ContactEntry,
): boolean {
  return (
    left.id === right.id &&
    left.documentId === right.documentId &&
    left.syncing === right.syncing &&
    sameContactRows(left.rows, right.rows) &&
    (left.canWrite !== false) === (right.canWrite !== false) &&
    left.firstName === right.firstName &&
    left.lastName === right.lastName &&
    left.nickname === right.nickname &&
    left.userId === right.userId &&
    left.encapsulationPublicKey === right.encapsulationPublicKey &&
    left.isSelf === right.isSelf &&
    sameContactAvatarRef(left.avatar, right.avatar)
  );
}
