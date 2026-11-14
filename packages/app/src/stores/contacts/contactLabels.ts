import type { StoredDocumentKind } from "@tearleads/client-sdk";
import {
  type ContactEntry,
  getContactDisplayName,
} from "../../document-types/contact/contactDocumentModel";
import {
  matchesSelfContactIdentity,
  type SelfContactIdentityView,
} from "./currentSelfContactIdentityState";
import { isCurrentSelfContactLocalId } from "./selfContact";

const YOU_LABEL = "You";

export function findCurrentSelfContactLocalId(
  entries: ReadonlyArray<ContactEntry>,
  selfContactIdentity: SelfContactIdentityView | null | undefined,
): string | null {
  if (
    selfContactIdentity?.status !== "ready" ||
    !selfContactIdentity.isCurrent()
  ) {
    return null;
  }

  return (
    entries.find((entry) =>
      matchesSelfContactIdentity(selfContactIdentity.identity, entry),
    )?.id ?? null
  );
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

  return "Untitled contact";
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
