import type { StoredDocumentKind } from "@tearleads/client-sdk";
import {
  type ContactEntry,
  getContactDisplayName,
} from "../../document-types/contact/contactDocumentModel";
import { isCurrentSelfContactLocalId } from "./selfContact";

const YOU_LABEL = "You";

export function findCurrentSelfContactLocalId(
  entries: ReadonlyArray<ContactEntry>,
  currentUserId: string | null | undefined,
): string | null {
  if (!currentUserId) {
    return null;
  }

  return (
    entries.find(
      (entry) =>
        entry.isSelf &&
        entry.userId === currentUserId &&
        entry.canWrite !== false,
    )?.id ?? null
  );
}

// Extract the time_low field (first 32 bits) from a UUID string.
function timeLow(uuid: string): string {
  return uuid.split("-")[0] ?? uuid;
}

export function getViewerRelativeContactLabel(
  entry: ContactEntry,
  currentSigningFingerprint: string | null | undefined,
  currentUserId?: string | null | undefined,
): string {
  const name = getContactDisplayName(entry);
  if (name.length > 0) {
    return name;
  }

  if (
    isCurrentSelfContactLocalId(entry.id, currentSigningFingerprint) ||
    (entry.isSelf && Boolean(currentUserId) && entry.userId === currentUserId)
  ) {
    return YOU_LABEL;
  }

  return entry.userId ? timeLow(entry.userId) : "Untitled contact";
}

function isUnnamedCurrentSelfContactFallback(input: {
  currentUserId?: string | null | undefined;
  fallbackLabel: string;
}): boolean {
  const label = input.fallbackLabel.trim();
  return (
    label.length === 0 ||
    label === "Untitled contact" ||
    (Boolean(input.currentUserId) && label === input.currentUserId)
  );
}

export function getViewerRelativeContactDocumentLabel(input: {
  currentSigningFingerprint: string | null | undefined;
  currentSelfContactLocalId?: string | null | undefined;
  currentUserId?: string | null | undefined;
  documentKind: StoredDocumentKind | string | null | undefined;
  fallbackLabel: string;
  localId: string;
}): string {
  const matchesProjectedSelfContact =
    Boolean(input.currentSelfContactLocalId) &&
    input.localId === input.currentSelfContactLocalId;
  if (
    input.documentKind === "contact" &&
    (isCurrentSelfContactLocalId(
      input.localId,
      input.currentSigningFingerprint,
    ) ||
      matchesProjectedSelfContact) &&
    isUnnamedCurrentSelfContactFallback(input)
  ) {
    return YOU_LABEL;
  }

  return input.fallbackLabel;
}
