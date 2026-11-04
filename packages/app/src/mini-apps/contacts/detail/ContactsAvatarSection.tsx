import type {
  BlobStore,
  DocumentAttachmentUpload,
} from "@tearleads/client-sdk";
import { useMemo } from "react";
import { ContactAvatarControl } from "../../../document-types/contact/ContactAvatarControl";
import { useContactAvatarUrls } from "../../../document-types/contact/useContactAvatarUrls";
import { getViewerRelativeContactLabel } from "../../../stores/contacts/contactLabels";
import type { ContactEntries } from "../types";

export function ContactsAvatarSection({
  blobStore,
  canEdit,
  currentSigningFingerprint,
  currentUserId,
  entry,
  removeContactAvatar,
  setContactAvatar,
}: {
  blobStore: BlobStore;
  canEdit: boolean;
  currentSigningFingerprint: string | null | undefined;
  currentUserId: string | null | undefined;
  entry: ContactEntries[number];
  removeContactAvatar: (contactId: string) => void;
  setContactAvatar: (
    contactId: string,
    upload: DocumentAttachmentUpload,
  ) => void;
}) {
  const avatarEntries = useMemo(() => [entry], [entry]);
  const avatarUrlByContactId = useContactAvatarUrls(avatarEntries, blobStore);
  // Same viewer-relative label as the sidebar row, so an unnamed self contact
  // reads "You" on both sides.
  const displayName = getViewerRelativeContactLabel(
    entry,
    currentSigningFingerprint,
    currentUserId,
  );

  // The photo and name head the card, so the person is named before the
  // fields that describe them.
  return (
    <div className="contacts-detail-header">
      <ContactAvatarControl
        avatarUrl={avatarUrlByContactId[entry.id]}
        canEdit={canEdit}
        displayName={displayName}
        hasAvatar={Boolean(entry.avatar)}
        onApplyAvatar={(upload) => setContactAvatar(entry.id, upload)}
        onRemoveAvatar={() => removeContactAvatar(entry.id)}
      />
      <h2 className="contacts-detail-name">{displayName}</h2>
    </div>
  );
}
