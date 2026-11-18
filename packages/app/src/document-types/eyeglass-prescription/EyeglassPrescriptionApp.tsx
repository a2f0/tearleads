import { useId } from "react";
import { createDocumentTypeApp } from "../shared/createDocumentTypeApp";
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
  EYEGLASS_PRESCRIPTION_DOCUMENT_KIND,
  PRESCRIPTION_FIELDS,
  readPrescriptionFields,
} from "./eyeglassPrescriptionDocumentDefinition";

const attachmentSlots = [
  { label: "Prescription Image", slotId: "prescription-image" },
];

function readFields(source: Readonly<Record<string, unknown>>) {
  return readPrescriptionFields(source).fields;
}

function EyeglassPrescription(params: {
  containerId: string | null;
  initialEditing?: boolean | undefined;
  localId: string;
}) {
  const id = useId();
  const doc = useAttachedStructuredDocument({
    ...params,
    documentLabel: "eyeglass prescription",
    readFields,
    slots: attachmentSlots,
  });
  const disabled = !doc.canWrite || !doc.ready;
  useStructuredDocumentEditAction({
    disabled,
    id: "eyeglass-prescription-toggle-edit",
    isEditing: doc.isEditing,
    onToggleEditing: doc.toggleEditing,
  });

  return (
    <StructuredDocument
      fields={
        doc.isEditing && doc.canWrite ? (
          <StructuredDocumentFields>
            {PRESCRIPTION_FIELDS.map(({ key, label, type }) => (
              <StructuredDocumentField
                key={key}
                inputId={`${id}-${key}`}
                label={label}
              >
                <input
                  id={`${id}-${key}`}
                  type={type}
                  value={doc.fields[key] ?? ""}
                  autoComplete="off"
                  disabled={disabled}
                  onChange={(event) =>
                    doc.setStructuredFields(
                      EYEGLASS_PRESCRIPTION_DOCUMENT_KIND,
                      {
                        [key]: event.target.value,
                      },
                    )
                  }
                />
              </StructuredDocumentField>
            ))}
          </StructuredDocumentFields>
        ) : (
          <StructuredDocumentReadFields
            fields={PRESCRIPTION_FIELDS.map(({ key, label }) => ({
              label,
              value: doc.fields[key],
            }))}
          />
        )
      }
      attachments={
        <DocumentAttachmentSlots
          {...doc.slotsProps}
          className="structured-document-attachments--single"
        />
      }
    />
  );
}

export const EyeglassPrescriptionDocumentApp = createDocumentTypeApp(
  EYEGLASS_PRESCRIPTION_DOCUMENT_KIND,
  EyeglassPrescription,
);
