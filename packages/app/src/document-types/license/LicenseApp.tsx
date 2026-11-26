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
  getLicenseFieldLabel,
  LICENSE_DOCUMENT_KIND,
  LICENSE_FIELDS,
  LICENSE_SLOTS,
  LICENSE_TYPE_OPTIONS,
  type LicenseDocumentFields,
  readLicenseFieldValues,
} from "./licenseDocumentDefinition";

const LICENSE_TYPE_FIELD: VariantDocumentTypeField<"licenseType"> = {
  ariaLabel: "License type",
  key: "licenseType",
  label: "License Type",
  options: LICENSE_TYPE_OPTIONS,
};

/** The license's fields, read or edited; the type decides the variant fields. */
export function LicenseFields(params: {
  disabled: boolean;
  fields: LicenseDocumentFields;
  isEditing: boolean;
  onChange: (patch: Partial<LicenseDocumentFields>) => void;
  ready: boolean;
}) {
  return (
    <VariantDocumentFields
      {...params}
      definitions={LICENSE_FIELDS}
      getLabel={getLicenseFieldLabel}
      typeField={LICENSE_TYPE_FIELD}
    />
  );
}

function License(params: {
  containerId: string | null;
  initialEditing?: boolean | undefined;
  localId: string;
}) {
  const doc = useAttachedStructuredDocument({
    containerId: params.containerId,
    documentLabel: "license",
    initialEditing: params.initialEditing,
    localId: params.localId,
    readFields: readLicenseFieldValues,
    slots: LICENSE_SLOTS,
  });
  const disabled = !doc.canWrite || !doc.ready;
  useStructuredDocumentEditAction({
    disabled,
    id: "license-toggle-edit",
    isEditing: doc.isEditing,
    onToggleEditing: doc.toggleEditing,
  });

  return (
    <StructuredDocument
      attachments={<DocumentAttachmentSlots {...doc.slotsProps} />}
      fields={
        <LicenseFields
          disabled={disabled}
          fields={doc.fields}
          isEditing={doc.isEditing && doc.canWrite}
          onChange={(patch) =>
            doc.setStructuredFields(LICENSE_DOCUMENT_KIND, patch)
          }
          ready={doc.ready}
        />
      }
    />
  );
}

export const LicenseDocumentApp = createDocumentTypeApp(
  LICENSE_DOCUMENT_KIND,
  License,
);
