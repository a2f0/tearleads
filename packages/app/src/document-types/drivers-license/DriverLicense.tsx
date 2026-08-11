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
  DRIVER_LICENSE_ATTACHMENT_SLOTS,
  readDriverLicenseFields,
} from "./driverLicenseDocument";
import type { DriverLicenseDocumentFields } from "./driverLicenseDocumentDefinition";

type DriverLicenseStructuredFieldSetter = ReturnType<
  typeof useDocument
>["setStructuredFields"];

export function DriverLicenseFields(params: {
  disabled?: boolean | undefined;
  fields: DriverLicenseDocumentFields;
  inputIds: {
    expirationDate: string;
    licenseId: string;
  };
  isEditing: boolean;
  onChange: (patch: Partial<DriverLicenseDocumentFields>) => void;
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
          { label: "License ID Number", value: fields.licenseId },
          { label: "Expiration Date", value: fields.expirationDate },
        ]}
      />
    );
  }

  return (
    <StructuredDocumentFields>
      <StructuredDocumentField
        inputId={inputIds.licenseId}
        label="License ID Number"
      >
        <input
          id={inputIds.licenseId}
          aria-label="Driver's license ID number"
          value={fields.licenseId}
          onChange={(event) => onChange({ licenseId: event.target.value })}
          placeholder={ready ? "DL-1234567" : "Loading..."}
          disabled={disabled}
        />
      </StructuredDocumentField>
      <StructuredDocumentField
        inputId={inputIds.expirationDate}
        label="Expiration Date"
      >
        <input
          id={inputIds.expirationDate}
          aria-label="Driver's license expiration date"
          type="date"
          value={fields.expirationDate}
          onChange={(event) => onChange({ expirationDate: event.target.value })}
          disabled={disabled}
        />
      </StructuredDocumentField>
    </StructuredDocumentFields>
  );
}

export function DriverLicenseDocumentFieldsPane(params: {
  canWrite: boolean;
  fields: DriverLicenseDocumentFields;
  inputIds: {
    expirationDate: string;
    licenseId: string;
  };
  isEditing: boolean;
  onToggleEditing: () => void;
  ready: boolean;
  setStructuredFields: DriverLicenseStructuredFieldSetter;
}) {
  useStructuredDocumentEditAction({
    disabled: !params.ready || !params.canWrite,
    id: "driver-license-toggle-edit",
    isEditing: params.isEditing,
    onToggleEditing: params.onToggleEditing,
  });

  return (
    <DriverLicenseFields
      disabled={!params.ready || !params.canWrite}
      fields={params.fields}
      inputIds={params.inputIds}
      isEditing={params.isEditing && params.canWrite}
      onChange={(patch) => {
        if (params.canWrite) {
          params.setStructuredFields("drivers_license", patch);
        }
      }}
      ready={params.ready}
    />
  );
}

export function DriverLicense(params: {
  containerId: string | null;
  initialEditing?: boolean | undefined;
  localId: string;
}) {
  const doc = useAttachedStructuredDocument({
    containerId: params.containerId,
    documentLabel: "driver's license",
    initialEditing: params.initialEditing,
    localId: params.localId,
    readFields: readDriverLicenseFields,
    slots: DRIVER_LICENSE_ATTACHMENT_SLOTS,
  });
  const inputIds = {
    expirationDate: useId(),
    licenseId: useId(),
  };
  return (
    <StructuredDocument
      attachments={<DocumentAttachmentSlots {...doc.slotsProps} />}
      fields={
        <DriverLicenseDocumentFieldsPane
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
