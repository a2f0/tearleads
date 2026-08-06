import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
} from "react";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import {
  useDocument,
  useDocumentReadOnly,
} from "../../stores/documents/DocumentsProvider";
import {
  StructuredDocument,
  useStructuredDocumentEditAction,
  useStructuredDocumentEditing,
} from "../shared/StructuredDocument";
import { useAttachmentImageUrls } from "../shared/useAttachmentImageUrls";
import "./ContactDocument.css";
import { ContactAvatarControl } from "./ContactAvatarControl";
import { ContactFields } from "./ContactFields";
import {
  CONTACT_AVATAR_SLOT_ID,
  getContactAvatarRef,
} from "./contactAvatarSlot";
import { readContactFields } from "./contactDocumentModel";
import type { ContactFieldValues } from "./contactFieldDescriptors";

type ContactStructuredFieldSetter = ReturnType<
  typeof useDocument
>["setStructuredFields"];

function toContactFieldValues(
  fields: ReturnType<typeof readContactFields>,
): ContactFieldValues {
  return {
    encapsulationPublicKey: fields.encapsulationPublicKey,
    firstName: fields.firstName,
    lastName: fields.lastName,
    nickname: fields.nickname,
    userId: fields.userId,
  };
}

export function ContactDocumentFields({
  isEditing,
  ready,
  canWrite,
  setEditing,
  setStructuredFields,
  values,
}: {
  isEditing: boolean;
  ready: boolean;
  canWrite: boolean;
  setEditing: Dispatch<SetStateAction<boolean>>;
  setStructuredFields: ContactStructuredFieldSetter;
  values: ContactFieldValues;
}) {
  // Kept reference-stable so the toolbar action it feeds does not re-register
  // on every render.
  const toggleEditing = useCallback(
    () => setEditing((editing) => !editing),
    [setEditing],
  );
  useStructuredDocumentEditAction({
    disabled: !ready || !canWrite,
    id: "contact-document-toggle-edit",
    isEditing,
    onToggleEditing: toggleEditing,
  });

  return (
    <div className="contact-document-fields">
      <ContactFields
        disabled={!ready || !canWrite}
        isEditing={isEditing && canWrite}
        onFieldCommit={(key, value) => {
          if (canWrite) {
            setStructuredFields("contact", { [key]: value });
          }
        }}
        values={values}
      />
    </div>
  );
}

// The avatar block rendered in the Explorer's contact document view. It talks
// to the document attachment API directly (the Contacts mini-app instead goes
// through the contacts store, which wraps the same slot).
function ContactDocumentAvatar({
  displayName,
  isEditing,
}: {
  displayName: string;
  isEditing: boolean;
}) {
  const {
    attachments,
    attachmentStorageKeyBySlotId,
    canAttach,
    canWrite,
    removeAttachment,
    replaceAttachment,
  } = useDocument();
  const readOnly = useDocumentReadOnly();
  const { infra } = useTearleadsRuntime();
  const imageUrlBySlotId = useAttachmentImageUrls(
    attachments,
    attachmentStorageKeyBySlotId,
    infra.blobStore,
  );
  const avatar = getContactAvatarRef(attachments, attachmentStorageKeyBySlotId);

  return (
    <ContactAvatarControl
      avatarUrl={imageUrlBySlotId[CONTACT_AVATAR_SLOT_ID]}
      canEdit={isEditing && canAttach && canWrite && !readOnly}
      displayName={displayName}
      hasAvatar={Boolean(avatar)}
      onApplyAvatar={(upload) =>
        replaceAttachment(CONTACT_AVATAR_SLOT_ID, upload)
      }
      onRemoveAvatar={() => removeAttachment(CONTACT_AVATAR_SLOT_ID)}
    />
  );
}

export function ContactDocument(params: {
  initialEditing?: boolean | undefined;
}) {
  const { canWrite, ready, setStructuredFields, structuredFields } =
    useDocument();
  const [isEditing, setIsEditing] = useStructuredDocumentEditing(
    canWrite,
    params.initialEditing,
  );
  const values = useMemo(
    () => toContactFieldValues(readContactFields(structuredFields)),
    [structuredFields],
  );
  const displayName =
    values.nickname.trim() || `${values.firstName} ${values.lastName}`.trim();

  return (
    <StructuredDocument
      fields={
        <ContactDocumentFields
          isEditing={isEditing}
          ready={ready}
          canWrite={canWrite}
          setEditing={setIsEditing}
          setStructuredFields={setStructuredFields}
          values={values}
        />
      }
      // Heads the document, matching the Contacts mini-app's detail panel,
      // which puts the avatar above the fields.
      leading={
        <ContactDocumentAvatar
          displayName={displayName}
          isEditing={isEditing}
        />
      }
    />
  );
}
