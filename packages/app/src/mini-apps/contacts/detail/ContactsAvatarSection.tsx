import type {
  BlobStore,
  DocumentAttachmentUpload,
} from "@tearleads/client-sdk";
import { useMemo } from "react";
import { ContactAvatarControl } from "../../../document-types/contact/ContactAvatarControl";
import { getContactDisplayName } from "../../../document-types/contact/contactDocumentModel";
import { useContactAvatarUrls } from "../../../document-types/contact/useContactAvatarUrls";
import { CONTACTS_LABELS } from "../labels";
import type { ContactEntries } from "../types";

export function ContactsAvatarSection({
  blobStore,
  canEdit,
  entry,
  removeContactAvatar,
  setContactAvatar,
}: {
  blobStore: BlobStore;
  canEdit: boolean;
  entry: ContactEntries[number];
  removeContactAvatar: (contactId: string) => void;
  setContactAvatar: (
    contactId: string,
    upload: DocumentAttachmentUpload,
  ) => void;
}) {
  const avatarEntries = useMemo(() => [entry], [entry]);
  const avatarUrlByContactId = useContactAvatarUrls(avatarEntries, blobStore);
  const displayName = getContactDisplayName(entry);

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
      <h2 className="contacts-detail-name">
        {displayName || CONTACTS_LABELS.unnamedContact}
      </h2>
    </div>
  );
}
