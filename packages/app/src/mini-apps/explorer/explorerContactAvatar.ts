import type { StoredDocumentKind } from "@tearleads/client-sdk";
import type { AvatarUrlByContactId } from "../../document-types/contact/useContactAvatarUrls";

// Contact rows swap their document-kind glyph for the contact's avatar once one
// is loaded, matching the Contacts mini-app's list rows. Returns undefined for
// every other document kind, for contacts with no avatar, and for contacts
// outside the Explorer's contacts container (whose avatars are never loaded) —
// callers fall back to the glyph.
export function getExplorerContactAvatarUrl(
  documentKind: StoredDocumentKind,
  localId: string,
  avatarUrlByLocalId: AvatarUrlByContactId,
): string | undefined {
  if (documentKind !== "contact") {
    return undefined;
  }

  return avatarUrlByLocalId[localId];
}
