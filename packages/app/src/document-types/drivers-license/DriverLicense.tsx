import { useCallback, useId, useMemo } from "react";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import { DocumentAttachmentSlots } from "../shared/DocumentAttachmentSlots";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
  StructuredDocumentReadFields,
  useStructuredDocumentEditAction,
  useStructuredDocumentEditing,
} from "../shared/StructuredDocument";
import { useAttachmentImageUrls } from "../shared/useAttachmentImageUrls";
import { useBlobPickAttachment } from "../shared/useBlobPickAttachment";
import { useDocumentAttachmentSelection } from "../shared/useDocumentAttachmentSelection";
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

const DRIVER_LICENSE_ATTACHMENT_SLOT_IDS = DRIVER_LICENSE_ATTACHMENT_SLOTS.map(
  (slot) => slot.slotId,
);

export function DriverLicense(params: {
  containerId: string | null;
  initialEditing?: boolean | undefined;
  localId: string;
}) {
  const { infra } = useTearleadsRuntime();
  const { blobStore } = infra;
  const {
    attachments,
    attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId,
    canAttach,
    canWrite,
    ready,
    removeAttachment,
    replaceAttachment,
    setStructuredFields,
    structuredFields,
  } = useDocument();
  const fields = useMemo(
    () => readDriverLicenseFields(structuredFields),
    [structuredFields],
  );
  const [isEditing, setIsEditing] = useStructuredDocumentEditing(
    canWrite,
    params.initialEditing,
  );
  // Kept reference-stable so the toolbar action it feeds does not re-register
  // on every render.
  const toggleEditing = useCallback(
    () => setIsEditing((editing) => !editing),
    [setIsEditing],
  );
  const inputIds = {
    expirationDate: useId(),
    licenseId: useId(),
  };
  const imageUrlBySlotId = useAttachmentImageUrls(
    attachments,
    attachmentStorageKeyBySlotId,
    blobStore,
  );
  const handleSelectedAttachment = useDocumentAttachmentSelection({
    errorMessage: "Failed to handle driver's license attachment selection",
    replaceAttachment,
  });
  const blobPicker = useBlobPickAttachment({
    blobStore,
    containerId: params.containerId,
    errorMessage: "Failed to handle driver's license blob attachment selection",
    localId: params.localId,
    replaceAttachment,
    slotIds: DRIVER_LICENSE_ATTACHMENT_SLOT_IDS,
  });

  return (
    <StructuredDocument
      attachments={
        <DocumentAttachmentSlots
          attachmentStorageKeyBySlotId={attachmentStorageKeyBySlotId}
          attachmentStatusBySlotId={attachmentStatusBySlotId}
          attachments={attachments}
          blobPicker={blobPicker}
          canAttach={canAttach && isEditing && canWrite}
          imageUrlBySlotId={imageUrlBySlotId}
          onClearAttachment={removeAttachment}
          onSelectedAttachment={handleSelectedAttachment}
          slots={DRIVER_LICENSE_ATTACHMENT_SLOTS}
        />
      }
      fields={
        <DriverLicenseDocumentFieldsPane
          canWrite={canWrite}
          fields={fields}
          inputIds={inputIds}
          isEditing={isEditing}
          onToggleEditing={toggleEditing}
          ready={ready}
          setStructuredFields={setStructuredFields}
        />
      }
    />
  );
}
