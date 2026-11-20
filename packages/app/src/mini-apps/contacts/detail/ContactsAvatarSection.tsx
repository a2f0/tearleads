import { ContactAvatar } from "../../../document-types/contact/ContactAvatar";
import { useContactPhotos } from "../../../document-types/contact/useContactPhotos";
import { getViewerRelativeContactLabel } from "../../../stores/contacts/contactLabels";
import type { ContactsStore } from "../../../stores/contacts/contactStore";
import { DocumentContext } from "../../../stores/documents/DocumentsProvider";
import type { ContactEntries } from "../types";

function ContactPhotoHeader({
  displayName,
  isEditing,
}: {
  displayName: string;
  isEditing: boolean;
}) {
  const { avatar, gallery } = useContactPhotos({ displayName, isEditing });
  return (
    <>
      <div className="contacts-detail-header">
        {avatar}
        <h2 className="contacts-detail-name">{displayName}</h2>
      </div>
      {gallery}
    </>
  );
}

export function ContactsAvatarSection({
  getContactDocumentStore,
  canEdit,
  currentSigningFingerprint,
  currentUserId,
  entry,
}: {
  getContactDocumentStore: ContactsStore["getContactDocumentStore"];
  canEdit: boolean;
  currentSigningFingerprint: string | null | undefined;
  currentUserId: string | null | undefined;
  entry: ContactEntries[number];
}) {
  const store = getContactDocumentStore(entry.id);
  // Same viewer-relative label as the sidebar row, so an unnamed self contact
  // reads "You" on both sides.
  const displayName = getViewerRelativeContactLabel(
    entry,
    currentSigningFingerprint,
    currentUserId,
  );

  if (store)
    return (
      <DocumentContext.Provider value={store}>
        <ContactPhotoHeader displayName={displayName} isEditing={canEdit} />
      </DocumentContext.Provider>
    );
  return (
    <div className="contacts-detail-header">
      <ContactAvatar size="large" />
      <h2 className="contacts-detail-name">{displayName}</h2>
    </div>
  );
}
