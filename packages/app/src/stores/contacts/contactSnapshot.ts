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
  const nickname = entry.nickname.trim();
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

export function sameContactEntry(
  left: ContactEntry,
  right: ContactEntry,
): boolean {
  return (
    left.id === right.id &&
    (left.canWrite !== false) === (right.canWrite !== false) &&
    left.firstName === right.firstName &&
    left.lastName === right.lastName &&
    left.nickname === right.nickname &&
    left.userId === right.userId &&
    left.encapsulationPublicKey === right.encapsulationPublicKey &&
    left.isSelf === right.isSelf
  );
}
