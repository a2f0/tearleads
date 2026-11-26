import { createDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { DocumentAttachmentSlots } from "../shared/DocumentAttachmentSlots";
import {
  StructuredDocument,
  useStructuredDocumentEditAction,
} from "../shared/StructuredDocument";
import { useAttachedStructuredDocument } from "../shared/useAttachedStructuredDocument";
import {
  VariantDocumentFields,
  type VariantDocumentTypeField,
} from "../shared/VariantDocumentFields";
import {
  getInsurancePolicyFieldLabel,
  INSURANCE_POLICY_DOCUMENT_KIND,
  INSURANCE_POLICY_FIELDS,
  INSURANCE_POLICY_SLOTS,
  INSURANCE_POLICY_TYPE_OPTIONS,
  type InsurancePolicyDocumentFields,
  readInsurancePolicyFieldValues,
} from "./insurancePolicyDocumentDefinition";

const POLICY_TYPE_FIELD: VariantDocumentTypeField<"policyType"> = {
  ariaLabel: "Policy type",
  key: "policyType",
  label: "Policy Type",
  options: INSURANCE_POLICY_TYPE_OPTIONS,
};

/** The policy's fields, read or edited; the type decides the variant fields. */
export function InsurancePolicyFields(params: {
  disabled: boolean;
  fields: InsurancePolicyDocumentFields;
  isEditing: boolean;
  onChange: (patch: Partial<InsurancePolicyDocumentFields>) => void;
  ready: boolean;
}) {
  return (
    <VariantDocumentFields
      {...params}
      definitions={INSURANCE_POLICY_FIELDS}
      getLabel={getInsurancePolicyFieldLabel}
      typeField={POLICY_TYPE_FIELD}
    />
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
