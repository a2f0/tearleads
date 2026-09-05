import { useId } from "react";
import type { useDocument } from "../../stores/documents/DocumentsProvider";
import { DocumentAttachmentSlots } from "../shared/DocumentAttachmentSlots";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
  StructuredDocumentReadFields,
  useStructuredDocumentEditAction,
} from "../shared/StructuredDocument";
import { useAttachedStructuredDocument } from "../shared/useAttachedStructuredDocument";
import {
  PASSPORT_ATTACHMENT_SLOTS,
  type PassportDocumentFields,
  readPassportFields,
} from "./passportDocument";

type PassportStructuredFieldSetter = ReturnType<
  typeof useDocument
>["setStructuredFields"];

export function PassportFields(params: {
  disabled?: boolean | undefined;
  fields: PassportDocumentFields;
  inputIds: {
    expirationDate: string;
    fullName: string;
    issuingCountry: string;
    passportNumber: string;
  };
  isEditing: boolean;
  onChange: (patch: Partial<PassportDocumentFields>) => void;
  ready: boolean;
}) {
  const {
    disabled = false,
    fields,
    inputIds,
    isEditing,
    onChange,
    ready,
  } = params;

  if (!isEditing) {
    return (
      <StructuredDocumentReadFields
        fields={[
          { label: "Full Name", value: fields.fullName },
          { label: "Passport Number", value: fields.passportNumber },
          { label: "Issuing Country", value: fields.issuingCountry },
          { label: "Expiration Date", value: fields.expirationDate },
        ]}
      />
    );
  }

  return (
    <StructuredDocumentFields>
      <StructuredDocumentField inputId={inputIds.fullName} label="Full Name">
        <input
          id={inputIds.fullName}
          aria-label="Passport full name"
          value={fields.fullName}
          onChange={(event) => onChange({ fullName: event.target.value })}
          placeholder={ready ? "Ada Lovelace" : "Loading..."}
          disabled={disabled}
          autoComplete="name"
        />
      </StructuredDocumentField>
      <StructuredDocumentField
        inputId={inputIds.passportNumber}
        label="Passport Number"
      >
        <input
          id={inputIds.passportNumber}
          aria-label="Passport number"
          value={fields.passportNumber}
          onChange={(event) => onChange({ passportNumber: event.target.value })}
          placeholder={ready ? "P1234567" : "Loading..."}
          disabled={disabled}
          autoComplete="off"
        />
      </StructuredDocumentField>
      <StructuredDocumentField
        inputId={inputIds.issuingCountry}
        label="Issuing Country"
      >
        <input
          id={inputIds.issuingCountry}
          aria-label="Passport issuing country"
          value={fields.issuingCountry}
          onChange={(event) => onChange({ issuingCountry: event.target.value })}
          placeholder={ready ? "United States" : "Loading..."}
          disabled={disabled}
          autoComplete="country-name"
        />
      </StructuredDocumentField>
      <StructuredDocumentField
        inputId={inputIds.expirationDate}
        label="Expiration Date"
      >
        <input
          id={inputIds.expirationDate}
          aria-label="Passport expiration date"
          type="date"
          value={fields.expirationDate}
          onChange={(event) => onChange({ expirationDate: event.target.value })}
          disabled={disabled}
        />
      </StructuredDocumentField>
    </StructuredDocumentFields>
  );
}

export function PassportDocumentFieldsPane(params: {
  canWrite: boolean;
  fields: PassportDocumentFields;
  inputIds: {
    expirationDate: string;
    fullName: string;
    issuingCountry: string;
    passportNumber: string;
  };
  isEditing: boolean;
  onToggleEditing: () => void;
  ready: boolean;
  setStructuredFields: PassportStructuredFieldSetter;
}) {
  useStructuredDocumentEditAction({
    disabled: !params.ready || !params.canWrite,
    id: "passport-toggle-edit",
    isEditing: params.isEditing,
    onToggleEditing: params.onToggleEditing,
  });

  return (
    <PassportFields
      disabled={!params.ready || !params.canWrite}
      fields={params.fields}
      inputIds={params.inputIds}
      isEditing={params.isEditing && params.canWrite}
      onChange={(patch) => {
        if (params.canWrite) {
          params.setStructuredFields("passport", patch);
        }
      }}
      ready={params.ready}
    />
  );
}

interface PassportProps {
  containerId: string | null;
  initialEditing?: boolean | undefined;
  localId: string;
}

export function Passport(params: PassportProps) {
  const doc = useAttachedStructuredDocument({
    containerId: params.containerId,
    documentLabel: "passport",
    initialEditing: params.initialEditing,
    localId: params.localId,
    readFields: readPassportFields,
    slots: PASSPORT_ATTACHMENT_SLOTS,
  });
  const inputIds = {
    expirationDate: useId(),
    fullName: useId(),
    issuingCountry: useId(),
    passportNumber: useId(),
  };
  return (
    <StructuredDocument
      attachments={
        <DocumentAttachmentSlots
          {...doc.slotsProps}
          className="structured-document-attachments--single"
        />
      }
      fields={
        <PassportDocumentFieldsPane
          canWrite={doc.canWrite}
          fields={doc.fields}
          inputIds={inputIds}
          isEditing={doc.isEditing}
          onToggleEditing={doc.toggleEditing}
          ready={doc.ready}
          setStructuredFields={doc.setStructuredFields}
        />
      }
    />
  );
}
