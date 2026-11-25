import { useId, useMemo } from "react";
import { createDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { DocumentAttachmentSlots } from "../shared/DocumentAttachmentSlots";
import { RowLogDocument } from "../shared/RowLogDocument";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
  StructuredDocumentReadFields,
} from "../shared/StructuredDocument";
import { useStructuredDocumentAttachments } from "../shared/useAttachedStructuredDocument";
import { useTrackerDocument } from "../shared/useTrackerDocument";
import {
  MEDICATION_DOCUMENT_KIND,
  MEDICATION_FIELDS,
  MEDICATION_SLOTS,
  type MedicationDocumentFields,
  readMedicationFieldValues,
} from "./medicationDocumentDefinition";
import { MEDICATION_INTAKE_LOG } from "./medicationIntakeLog";

/** What was prescribed, read or edited. */
function MedicationFields(params: {
  disabled: boolean;
  fields: MedicationDocumentFields;
  isEditing: boolean;
  onChange: (patch: Partial<MedicationDocumentFields>) => void;
  ready: boolean;
}) {
  const { disabled, fields, isEditing, onChange, ready } = params;
  const id = useId();

  if (!isEditing) {
    return (
      <StructuredDocumentReadFields
        fields={MEDICATION_FIELDS.map((field) => ({
          label: field.label,
          value: fields[field.key],
        }))}
      />
    );
  }

  return (
    <StructuredDocumentFields>
      {MEDICATION_FIELDS.map((field) => {
        const inputId = `${id}-${field.key}`;
        return (
          <StructuredDocumentField
            key={field.key}
            inputId={inputId}
            label={field.label}
          >
            <input
              id={inputId}
              type={"type" in field ? field.type : "text"}
              value={fields[field.key]}
              placeholder={
                ready
                  ? "placeholder" in field
                    ? field.placeholder
                    : undefined
                  : "Loading..."
              }
              autoComplete="off"
              disabled={disabled}
              onChange={(event) =>
                onChange({ [field.key]: event.target.value })
              }
            />
          </StructuredDocumentField>
        );
      })}
    </StructuredDocumentFields>
  );
}

function Medication(params: {
  containerId: string | null;
  initialEditing?: boolean | undefined;
  localId: string;
}) {
  const tracker = useTrackerDocument(params.initialEditing);
  const fields = useMemo(
    () => readMedicationFieldValues(tracker.structuredFields),
    [tracker.structuredFields],
  );
  const slotsProps = useStructuredDocumentAttachments({
    containerId: params.containerId,
    documentLabel: "medication",
    isEditing: tracker.isEditing,
    localId: params.localId,
    slots: MEDICATION_SLOTS,
  });
  const fieldProps = {
    fields,
    onChange: (patch: Partial<MedicationDocumentFields>) =>
      tracker.setFields(MEDICATION_DOCUMENT_KIND, patch),
    ready: tracker.ready,
  };

  return (
    <StructuredDocument
      attachments={<DocumentAttachmentSlots {...slotsProps} />}
      fields={
        <RowLogDocument
          definition={MEDICATION_INTAKE_LOG}
          editActionId="medication-toggle-edit"
          readSummary={
            <MedicationFields {...fieldProps} disabled isEditing={false} />
          }
          renderEditFields={(controlsDisabled) => (
            <MedicationFields
              {...fieldProps}
              disabled={controlsDisabled}
              isEditing
            />
          )}
          tracker={tracker}
        />
      }
    />
  );
}

export const MedicationDocumentApp = createDocumentTypeApp(
  MEDICATION_DOCUMENT_KIND,
  Medication,
);
