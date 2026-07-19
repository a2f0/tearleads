import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { useMemo } from "react";
import { useWindowTitleBarAction } from "../../components/window/WindowMenuContext";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import {
  useDocument,
  useDocumentReadOnly,
} from "../../stores/documents/DocumentsProvider";
import {
  StructuredDocument,
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

const CONTACT_DOCUMENT_DONE_ACTION = "Done";
const CONTACT_DOCUMENT_EDIT_ACTION = "Edit";

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
  setEditing: (editing: boolean) => void;
  setStructuredFields: ContactStructuredFieldSetter;
  values: ContactFieldValues;
}) {
  // When the contact is host-forced read-only (e.g. in the Trash) the edit
  // affordance is removed entirely, not just disabled.
  const readOnly = useDocumentReadOnly();
  const editAction = useMemo(
    () => ({
      disabled: !ready || !canWrite,
      icon: isEditing ? (
        <CheckIcon aria-hidden size={18} />
      ) : (
        <PencilSimpleIcon aria-hidden size={18} />
      ),
      id: "contact-document-toggle-edit",
      label: isEditing
        ? CONTACT_DOCUMENT_DONE_ACTION
        : CONTACT_DOCUMENT_EDIT_ACTION,
      onClick: () => setEditing(!isEditing),
      priority: 100,
    }),
    [canWrite, isEditing, ready, setEditing],
  );

  useWindowTitleBarAction(readOnly ? null : editAction);

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
    setAttachment,
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
      onApplyAvatar={(upload) => setAttachment(CONTACT_AVATAR_SLOT_ID, upload)}
      onRemoveAvatar={() => removeAttachment(CONTACT_AVATAR_SLOT_ID)}
    />
  );
}

export function ContactDocument(params: {
  initialEditing?: boolean | undefined;
}) {
  const { canWrite, ready, setStructuredFields, structuredFields, syncing } =
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
      ready={ready}
      syncing={syncing}
      title="Contact"
    />
  );
}
