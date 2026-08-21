import type { StoredDocumentKind } from "@symcrypt/client-sdk";
import type { AvatarUrlByContactId } from "../../../document-types/contact/useContactAvatarUrls";

interface ExplorerContactAvatar {
  imageUrl: string | undefined;
}

// Distinguishes an avatar-less contact from a non-contact document so every
// Explorer view can render the shared ContactAvatar silhouette for the former.
export function getExplorerContactAvatar(
  documentKind: StoredDocumentKind,
  localId: string,
  avatarUrlByLocalId: AvatarUrlByContactId,
): ExplorerContactAvatar | null {
  if (documentKind !== "contact") {
    return null;
  }

  return { imageUrl: avatarUrlByLocalId[localId] };
}
