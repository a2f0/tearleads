import { useMemo, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
} from "../../components/shared/MiniAppLayout";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import { StructuredDocument } from "../shared/StructuredDocument";
import "./ContactDocument.css";
import { ContactFields } from "./ContactFields";
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

function ContactDocumentFields({
  isEditing,
  ready,
  setEditing,
  setStructuredFields,
  values,
}: {
  isEditing: boolean;
  ready: boolean;
  setEditing: (editing: boolean) => void;
  setStructuredFields: ContactStructuredFieldSetter;
  values: ContactFieldValues;
}) {
  return (
    <div className="contact-document-fields">
      <MiniAppActions>
        <MiniAppButton disabled={!ready} onClick={() => setEditing(!isEditing)}>
          {isEditing ? "Done" : "Edit"}
        </MiniAppButton>
      </MiniAppActions>
      <ContactFields
        isEditing={isEditing && ready}
        onFieldCommit={(key, value) =>
          setStructuredFields("contact", { [key]: value })
        }
        values={values}
      />
    </div>
  );
}

export function ContactDocument() {
  const { auth, state } = useTearleadsRuntime();
  const { isAuthenticated } = auth;
  const { online } = state;
  const { ready, setStructuredFields, structuredFields, syncing } =
    useDocument();
  const [isEditing, setIsEditing] = useState(false);
  const values = useMemo(
    () => toContactFieldValues(readContactFields(structuredFields)),
    [structuredFields],
  );

  return (
    <StructuredDocument
      attachmentCopy={{
        authenticatedOnline: "Contact documents do not use attachments.",
        localOnly: "Contact documents do not use attachments.",
        unavailable: "Contact documents do not use attachments.",
      }}
      attachments={null}
      canAttach={false}
      fields={
        <ContactDocumentFields
          isEditing={isEditing}
          ready={ready}
          setEditing={setIsEditing}
          setStructuredFields={setStructuredFields}
          values={values}
        />
      }
      isAuthenticated={isAuthenticated}
      online={online}
      ready={ready}
      syncing={syncing}
      title="Contact"
    />
  );
}
