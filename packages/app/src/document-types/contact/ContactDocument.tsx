import { useMemo } from "react";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import { useDocumentRowWriters } from "../../stores/documents/useDocumentRowWriters";
import {
  StructuredDocument,
  useStructuredDocumentEditAction,
  useStructuredDocumentEditing,
} from "../shared/StructuredDocument";
import "./ContactDocument.css";
import { ContactAddresses } from "./ContactAddresses";
import { ContactFields } from "./ContactFields";
import { readContactFields } from "./contactDocumentModel";
import type { ContactFieldValues } from "./contactFieldDescriptors";
import { useContactDocumentAddresses } from "./useContactDocumentAddresses";
import { useContactPhotos } from "./useContactPhotos";

type ContactStructuredFieldSetter = ReturnType<
  typeof useDocument
>["setStructuredFields"];

function toContactFieldValues(
  fields: ReturnType<typeof readContactFields>,
): ContactFieldValues {
  return {
    firstName: fields.firstName,
    lastName: fields.lastName,
    nickname: fields.nickname,
  };
}

export function ContactDocumentFields({
  isEditing,
  ready,
  canWrite,
  toggleEditing,
  setStructuredFields,
  values,
}: {
  isEditing: boolean;
  ready: boolean;
  canWrite: boolean;
  toggleEditing: () => void;
  setStructuredFields: ContactStructuredFieldSetter;
  values: ContactFieldValues;
}) {
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

export function ContactDocument(params: {
  initialEditing?: boolean | undefined;
}) {
  const document = useDocument();
  const addressActions = useContactDocumentAddresses();
  const resolveRowWriter = useDocumentRowWriters(document.rows.length > 0);
  const { canWrite, ready, setStructuredFields, structuredFields } = document;
  const [isEditing, , toggleEditing] = useStructuredDocumentEditing(
    canWrite,
    params.initialEditing,
  );
  const values = useMemo(
    () => toContactFieldValues(readContactFields(structuredFields)),
    [structuredFields],
  );
  const displayName =
    values.nickname.trim() || `${values.firstName} ${values.lastName}`.trim();

  const photos = useContactPhotos({ displayName, isEditing });
  return (
    <StructuredDocument
      attachments={
        <>
          <ContactAddresses
            key={addressActions.identityKey}
            rows={ready ? document.rows : undefined}
            disabled={!ready || !canWrite}
            isEditing={isEditing}
            currentAuthorId={document.currentAuthorId}
            resolveRowWriter={resolveRowWriter}
            {...addressActions.actions}
          />
          {photos.gallery}
        </>
      }
      fields={
        <ContactDocumentFields
          isEditing={isEditing}
          ready={ready}
          canWrite={canWrite}
          toggleEditing={toggleEditing}
          setStructuredFields={setStructuredFields}
          values={values}
        />
      }
      // Heads the document, matching the Contacts mini-app's detail panel,
      // which puts the avatar above the fields.
      leading={photos.avatar}
    />
  );
}
