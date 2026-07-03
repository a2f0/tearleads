import { useId, useMemo } from "react";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import { DocumentAttachmentSlots } from "../shared/DocumentAttachmentSlots";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
} from "../shared/StructuredDocument";
import { useAttachmentImageUrls } from "../shared/useAttachmentImageUrls";
import { useBlobPickAttachment } from "../shared/useBlobPickAttachment";
import { useDocumentAttachmentSelection } from "../shared/useDocumentAttachmentSelection";
import {
  PASSPORT_ATTACHMENT_SLOTS,
  type PassportDocumentFields,
  readPassportFields,
} from "./passportDocument";

function PassportFields(params: {
  fields: PassportDocumentFields;
  inputIds: {
    expirationDate: string;
    fullName: string;
    issuingCountry: string;
    passportNumber: string;
  };
  onChange: (patch: Partial<PassportDocumentFields>) => void;
  ready: boolean;
}) {
  const { fields, inputIds, onChange, ready } = params;

  return (
    <StructuredDocumentFields>
      <StructuredDocumentField inputId={inputIds.fullName} label="Full Name">
        <input
          id={inputIds.fullName}
          aria-label="Passport full name"
          value={fields.fullName}
          onChange={(event) => onChange({ fullName: event.target.value })}
          placeholder={ready ? "Ada Lovelace" : "Loading..."}
          disabled={!ready}
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
          disabled={!ready}
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
          disabled={!ready}
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
          disabled={!ready}
        />
      </StructuredDocumentField>
    </StructuredDocumentFields>
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

export function Passport(params: {
  containerId: string | null;
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
  const inputIds = {
    expirationDate: useId(),
    fullName: useId(),
    issuingCountry: useId(),
    passportNumber: useId(),
  };
  const imageUrlBySlotId = useAttachmentImageUrls(
    attachments,
    attachmentStorageKeyBySlotId,
    blobStore,
  );
  const handleSelectedAttachment = useDocumentAttachmentSelection({
    errorMessage: "Failed to handle passport attachment selection",
    setAttachment,
  });
  const blobPicker = useBlobPickAttachment({
    blobStore,
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
          canAttach={canAttach}
          imageUrlBySlotId={imageUrlBySlotId}
          onClearAttachment={removeAttachment}
          onSelectedAttachment={handleSelectedAttachment}
          slots={PASSPORT_ATTACHMENT_SLOTS}
        />
      }
      canAttach={canAttach}
      fields={
        <PassportFields
          fields={fields}
          inputIds={inputIds}
          onChange={(patch) => {
            setStructuredFields("passport", patch);
          }}
          ready={ready}
        />
      }
      isAuthenticated={isAuthenticated}
      online={online}
      ready={ready}
      syncing={syncing}
      title="Passport"
    />
  );
}
