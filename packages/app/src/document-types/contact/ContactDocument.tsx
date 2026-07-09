import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { useMemo } from "react";
import { useWindowTitleBarAction } from "../../components/window/WindowMenuContext";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import {
  StructuredDocument,
  useStructuredDocumentEditing,
} from "../shared/StructuredDocument";
import "./ContactDocument.css";
import { ContactFields } from "./ContactFields";
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

  useWindowTitleBarAction(editAction);

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
      ready={ready}
      syncing={syncing}
      title="Contact"
    />
  );
}
