import { useId, useMemo } from "react";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import { DocumentAttachmentSlots } from "../shared/DocumentAttachmentSlots";
import {
  StructuredDocument,
  StructuredDocumentEditActions,
  StructuredDocumentField,
  StructuredDocumentFields,
  StructuredDocumentReadFields,
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

function DriverLicenseDocumentFieldsPane(params: {
  canWrite: boolean;
  fields: DriverLicenseDocumentFields;
  inputIds: {
    expirationDate: string;
    licenseId: string;
  };
  isEditing: boolean;
  ready: boolean;
  setEditing: (editing: boolean) => void;
  setStructuredFields: DriverLicenseStructuredFieldSetter;
}) {
  return (
    <>
      <StructuredDocumentEditActions
        disabled={!params.ready || !params.canWrite}
        isEditing={params.isEditing}
        onToggleEditing={() => params.setEditing(!params.isEditing)}
      />
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
    </>
  );
}

const DRIVER_LICENSE_ATTACHMENT_COPY = {
  authenticatedOnline: "Images stay bound to fixed slots on this document.",
  localOnly: "Images save locally and sync when you're online.",
  unavailable: "Image attachments require a local key package.",
};

const DRIVER_LICENSE_ATTACHMENT_SLOT_IDS = DRIVER_LICENSE_ATTACHMENT_SLOTS.map(
  (slot) => slot.slotId,
);

export function DriverLicense(params: {
  containerId: string | null;
  initialEditing?: boolean | undefined;
  localId: string;
}) {
  const { auth, infra, state } = useTearleadsRuntime();
  const { isAuthenticated } = auth;
  const { blobStore } = infra;
  const { online } = state;
  const {
    attachments,
    attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId,
    canAttach,
    canWrite,
    ready,
    removeAttachment,
    setAttachment,
    setStructuredFields,
    structuredFields,
    syncing,
  } = useDocument();
  const fields = useMemo(
    () => readDriverLicenseFields(structuredFields),
    [structuredFields],
  );
  const [isEditing, setIsEditing] = useStructuredDocumentEditing(
    canWrite,
    params.initialEditing,
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
    setAttachment,
  });
  const blobPicker = useBlobPickAttachment({
    blobStore,
    containerId: params.containerId,
    errorMessage: "Failed to handle driver's license blob attachment selection",
    localId: params.localId,
    setAttachment,
    slotIds: DRIVER_LICENSE_ATTACHMENT_SLOT_IDS,
  });

  return (
    <StructuredDocument
      attachmentCopy={DRIVER_LICENSE_ATTACHMENT_COPY}
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
      canAttach={canAttach}
      fields={
        <DriverLicenseDocumentFieldsPane
          canWrite={canWrite}
          fields={fields}
          inputIds={inputIds}
          isEditing={isEditing}
          ready={ready}
          setEditing={setIsEditing}
          setStructuredFields={setStructuredFields}
        />
      }
      isAuthenticated={isAuthenticated}
      online={online}
      ready={ready}
      syncing={syncing}
      title="Driver's License"
    />
  );
}
