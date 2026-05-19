export interface ContactEntry {
  id: string;
  firstName: string;
  lastName: string;
  userId: string | null;
  encapsulationPublicKey: string | null;
  isSelf: boolean;
}

export interface ContactEntryPatch {
  firstName?: string | undefined;
  lastName?: string | undefined;
  userId?: string | null | undefined;
  encapsulationPublicKey?: string | null | undefined;
  isSelf?: boolean | undefined;
}

export function isTearleadsContact(
  entry: ContactEntry,
): entry is ContactEntry & {
  encapsulationPublicKey: string;
  userId: string;
} {
  return (
    typeof entry.userId === "string" &&
    entry.userId.length > 0 &&
    typeof entry.encapsulationPublicKey === "string" &&
    entry.encapsulationPublicKey.length > 0
  );
}

export function getContactDisplayName(entry: ContactEntry): string {
  const fullName = `${entry.firstName} ${entry.lastName}`.trim();
  if (fullName.length > 0) {
    return fullName;
  }

  return entry.userId ?? "Untitled contact";
}
