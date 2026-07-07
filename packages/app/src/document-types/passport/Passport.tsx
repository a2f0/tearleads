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

function PassportDocumentFieldsPane(params: {
  canWrite: boolean;
  fields: PassportDocumentFields;
  inputIds: {
    expirationDate: string;
    fullName: string;
    issuingCountry: string;
    passportNumber: string;
  };
  isEditing: boolean;
  ready: boolean;
  setEditing: (editing: boolean) => void;
  setStructuredFields: PassportStructuredFieldSetter;
}) {
  return (
    <>
      <StructuredDocumentEditActions
        disabled={!params.ready || !params.canWrite}
        isEditing={params.isEditing}
        onToggleEditing={() => params.setEditing(!params.isEditing)}
      />
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
    </>
  );
}

const PASSPORT_ATTACHMENT_COPY = {
  authenticatedOnline: "Passport image stays bound to this document.",
  localOnly: "Passport image saves locally and syncs when you're online.",
  unavailable: "Passport image attachment requires a local key package.",
};

const PASSPORT_ATTACHMENT_SLOT_IDS = PASSPORT_ATTACHMENT_SLOTS.map(
  (slot) => slot.slotId,
);

interface PassportProps {
  containerId: string | null;
  initialEditing?: boolean | undefined;
  localId: string;
}

export function Passport(params: PassportProps) {
  const { auth, infra, state } = useTearleadsRuntime();
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
    () => readPassportFields(structuredFields),
    [structuredFields],
  );
  const [isEditing, setIsEditing] = useStructuredDocumentEditing(
    canWrite,
    params.initialEditing,
  );
  const inputIds = {
    expirationDate: useId(),
    fullName: useId(),
    issuingCountry: useId(),
    passportNumber: useId(),
  };
  const imageUrlBySlotId = useAttachmentImageUrls(
    attachments,
    attachmentStorageKeyBySlotId,
    infra.blobStore,
  );
  const handleSelectedAttachment = useDocumentAttachmentSelection({
    errorMessage: "Failed to handle passport attachment selection",
    setAttachment,
  });
  const blobPicker = useBlobPickAttachment({
    blobStore: infra.blobStore,
    containerId: params.containerId,
    errorMessage: "Failed to handle passport blob attachment selection",
    localId: params.localId,
    setAttachment,
    slotIds: PASSPORT_ATTACHMENT_SLOT_IDS,
  });
  return (
    <StructuredDocument
      attachmentCopy={PASSPORT_ATTACHMENT_COPY}
      attachments={
        <DocumentAttachmentSlots
          attachmentStatusBySlotId={attachmentStatusBySlotId}
          attachments={attachments}
          blobPicker={blobPicker}
          canAttach={canAttach && isEditing && canWrite}
          imageUrlBySlotId={imageUrlBySlotId}
          onClearAttachment={removeAttachment}
          onSelectedAttachment={handleSelectedAttachment}
          slots={PASSPORT_ATTACHMENT_SLOTS}
        />
      }
      canAttach={canAttach}
      fields={
        <PassportDocumentFieldsPane
          canWrite={canWrite}
          fields={fields}
          inputIds={inputIds}
          isEditing={isEditing}
          ready={ready}
          setEditing={setIsEditing}
          setStructuredFields={setStructuredFields}
        />
      }
      isAuthenticated={auth.isAuthenticated}
      online={state.online}
      ready={ready}
      syncing={syncing}
      title="Passport"
    />
  );
}
