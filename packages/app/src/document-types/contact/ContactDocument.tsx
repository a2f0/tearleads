import { useId, useMemo } from "react";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
} from "../shared/StructuredDocument";
import { readContactFields } from "./contactDocumentModel";

type ContactDocumentFieldsValue = ReturnType<typeof readContactFields>;
type ContactStructuredFieldSetter = ReturnType<
  typeof useDocument
>["setStructuredFields"];

interface ContactDocumentFieldsFormProps {
  fields: ContactDocumentFieldsValue;
  inputIds: {
    encapsulationPublicKey: string;
    firstName: string;
    lastName: string;
    userId: string;
  };
  ready: boolean;
  setStructuredFields: ContactStructuredFieldSetter;
}

function ContactDocumentFieldsForm({
  fields,
  inputIds,
  ready,
  setStructuredFields,
}: ContactDocumentFieldsFormProps) {
  return (
    <StructuredDocumentFields>
      <StructuredDocumentField inputId={inputIds.firstName} label="First Name">
        <input
          id={inputIds.firstName}
          aria-label="Contact first name"
          value={fields.firstName}
          onChange={(event) =>
            setStructuredFields("contact", { firstName: event.target.value })
          }
          placeholder={ready ? "Ada" : "Loading..."}
          disabled={!ready}
        />
      </StructuredDocumentField>
      <StructuredDocumentField inputId={inputIds.lastName} label="Last Name">
        <input
          id={inputIds.lastName}
          aria-label="Contact last name"
          value={fields.lastName}
          onChange={(event) =>
            setStructuredFields("contact", { lastName: event.target.value })
          }
          placeholder={ready ? "Lovelace" : "Loading..."}
          disabled={!ready}
        />
      </StructuredDocumentField>
      <StructuredDocumentField
        inputId={inputIds.userId}
        label="Tearleads User ID"
      >
        <input
          id={inputIds.userId}
          aria-label="Contact user ID"
          value={fields.userId}
          onChange={(event) =>
            setStructuredFields("contact", { userId: event.target.value })
          }
          placeholder={ready ? "User ID" : "Loading..."}
          disabled={!ready}
        />
      </StructuredDocumentField>
      <StructuredDocumentField
        inputId={inputIds.encapsulationPublicKey}
        label="Public Key"
      >
        <textarea
          id={inputIds.encapsulationPublicKey}
          aria-label="Contact public key"
          value={fields.encapsulationPublicKey}
          onChange={(event) =>
            setStructuredFields("contact", {
              encapsulationPublicKey: event.target.value,
            })
          }
          placeholder={ready ? "Encapsulation public key" : "Loading..."}
          disabled={!ready}
        />
      </StructuredDocumentField>
    </StructuredDocumentFields>
  );
}

export function ContactDocument() {
  const { isAuthenticated, online } = useTearleadsRuntime();
  const { ready, setStructuredFields, structuredFields, syncing } =
    useDocument();
  const fields = useMemo(
    () => readContactFields(structuredFields),
    [structuredFields],
  );
  const inputIds = {
    firstName: useId(),
    lastName: useId(),
    userId: useId(),
    encapsulationPublicKey: useId(),
  };

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
        <ContactDocumentFieldsForm
          fields={fields}
          inputIds={inputIds}
          ready={ready}
          setStructuredFields={setStructuredFields}
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
