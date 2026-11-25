import { useId } from "react";
import { createDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { DocumentAttachmentSlots } from "../shared/DocumentAttachmentSlots";
import { DocumentFieldOptionSelect } from "../shared/DocumentFieldOptionSelect";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
  StructuredDocumentReadFields,
  useStructuredDocumentEditAction,
} from "../shared/StructuredDocument";
import { useAttachedStructuredDocument } from "../shared/useAttachedStructuredDocument";
import {
  getInsurancePolicyFieldLabel,
  getInsurancePolicyTypeLabel,
  getVisibleInsurancePolicyFields,
  INSURANCE_POLICY_DOCUMENT_KIND,
  INSURANCE_POLICY_SLOTS,
  INSURANCE_POLICY_TYPE_OPTIONS,
  type InsurancePolicyDocumentFields,
  readInsurancePolicyFieldValues,
} from "./insurancePolicyDocumentDefinition";

/** The policy's fields, read or edited; the type decides the variant fields. */
export function InsurancePolicyFields(params: {
  disabled: boolean;
  fields: InsurancePolicyDocumentFields;
  isEditing: boolean;
  onChange: (patch: Partial<InsurancePolicyDocumentFields>) => void;
  ready: boolean;
}) {
  const { disabled, fields, isEditing, onChange, ready } = params;
  const id = useId();
  const visibleFields = getVisibleInsurancePolicyFields(fields);
  const typeLabel = getInsurancePolicyTypeLabel(fields.policyType);

  if (!isEditing) {
    return (
      <StructuredDocumentReadFields
        fields={[
          {
            displayValue: typeLabel.length > 0 ? typeLabel : undefined,
            label: "Policy Type",
            value: fields.policyType,
          },
          ...visibleFields.map((field) => ({
            label: getInsurancePolicyFieldLabel(field, fields.policyType),
            value: fields[field.key],
          })),
        ]}
      />
    );
  }

  return (
    <StructuredDocumentFields>
      <StructuredDocumentField inputId={`${id}-policyType`} label="Policy Type">
        <DocumentFieldOptionSelect
          ariaLabel="Policy type"
          disabled={disabled}
          id={`${id}-policyType`}
          onChange={(value) => onChange({ policyType: value })}
          options={INSURANCE_POLICY_TYPE_OPTIONS}
          placeholder={ready ? "Select a type" : "Loading..."}
          value={fields.policyType}
        />
      </StructuredDocumentField>
      {visibleFields.map((field) => {
        const inputId = `${id}-${field.key}`;
        return (
          <StructuredDocumentField
            key={field.key}
            inputId={inputId}
            label={getInsurancePolicyFieldLabel(field, fields.policyType)}
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
              spellCheck={false}
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

function InsurancePolicy(params: {
  containerId: string | null;
  initialEditing?: boolean | undefined;
  localId: string;
}) {
  const doc = useAttachedStructuredDocument({
    containerId: params.containerId,
    documentLabel: "insurance policy",
    initialEditing: params.initialEditing,
    localId: params.localId,
    readFields: readInsurancePolicyFieldValues,
    slots: INSURANCE_POLICY_SLOTS,
  });
  const disabled = !doc.canWrite || !doc.ready;
  useStructuredDocumentEditAction({
    disabled,
    id: "insurance-policy-toggle-edit",
    isEditing: doc.isEditing,
    onToggleEditing: doc.toggleEditing,
  });

  return (
    <StructuredDocument
      attachments={<DocumentAttachmentSlots {...doc.slotsProps} />}
      fields={
        <InsurancePolicyFields
          disabled={disabled}
          fields={doc.fields}
          isEditing={doc.isEditing && doc.canWrite}
          onChange={(patch) =>
            doc.setStructuredFields(INSURANCE_POLICY_DOCUMENT_KIND, patch)
          }
          ready={doc.ready}
        />
      }
    />
  );
}

export const InsurancePolicyDocumentApp = createDocumentTypeApp(
  INSURANCE_POLICY_DOCUMENT_KIND,
  InsurancePolicy,
);
