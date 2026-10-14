import { useId } from "react";
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
  BIRTH_CERTIFICATE_ATTACHMENT_SLOTS,
  readBirthCertificateFields,
} from "./birthCertificateDocument";
import {
  BIRTH_CERTIFICATE_DOCUMENT_KIND,
  type BirthCertificateDocumentFields,
} from "./birthCertificateDocumentDefinition";

const FIELDS: ReadonlyArray<{
  key: keyof BirthCertificateDocumentFields;
  label: string;
  type: "text" | "date";
}> = [
  { key: "fullName", label: "Full Name", type: "text" },
  { key: "dateOfBirth", label: "Date of Birth", type: "date" },
  { key: "placeOfBirth", label: "Place of Birth", type: "text" },
  { key: "parentNames", label: "Parent Names", type: "text" },
  { key: "certificateNumber", label: "Certificate Number", type: "text" },
  { key: "issuingAuthority", label: "Issuing Authority", type: "text" },
  { key: "dateIssued", label: "Date Issued", type: "date" },
];

export function BirthCertificateFields(params: {
  fields: BirthCertificateDocumentFields;
  isEditing: boolean;
  disabled: boolean;
  onChange: (patch: Partial<BirthCertificateDocumentFields>) => void;
}) {
  const id = useId();
  if (!params.isEditing) {
    return (
      <StructuredDocumentReadFields
        fields={FIELDS.map(({ key, label }) => ({
          label,
          value: params.fields[key],
        }))}
      />
    );
  }
  return (
    <StructuredDocumentFields>
      {FIELDS.map(({ key, label, type }) => (
        <StructuredDocumentField
          key={key}
          inputId={`${id}-${key}`}
          label={label}
        >
          <input
            id={`${id}-${key}`}
            aria-label={`Birth certificate ${label.toLowerCase()}`}
            type={type}
            value={params.fields[key]}
            onChange={(event) => params.onChange({ [key]: event.target.value })}
            disabled={params.disabled}
            autoComplete="off"
          />
        </StructuredDocumentField>
      ))}
    </StructuredDocumentFields>
  );
}

export function BirthCertificate(params: {
  containerId: string | null;
  initialEditing?: boolean | undefined;
  localId: string;
}) {
  const doc = useAttachedStructuredDocument({
    ...params,
    documentLabel: "birth certificate",
    readFields: readBirthCertificateFields,
    slots: BIRTH_CERTIFICATE_ATTACHMENT_SLOTS,
  });
  useStructuredDocumentEditAction({
    disabled: !doc.ready || !doc.canWrite,
    id: "birth-certificate-toggle-edit",
    isEditing: doc.isEditing,
    onToggleEditing: doc.toggleEditing,
  });
  return (
    <StructuredDocument
      attachments={
        <DocumentAttachmentSlots
          {...doc.slotsProps}
          className="structured-document-attachments--single"
        />
      }
      fields={
        <BirthCertificateFields
          fields={doc.fields}
          isEditing={doc.isEditing && doc.canWrite}
          disabled={!doc.ready || !doc.canWrite}
          onChange={(patch) => {
            if (doc.canWrite)
              doc.setStructuredFields(BIRTH_CERTIFICATE_DOCUMENT_KIND, patch);
          }}
        />
      }
    />
  );
}
