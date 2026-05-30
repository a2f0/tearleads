import type { BlobInfoInput } from "@tearleads/client-sdk";
import { useCallback, useId, useMemo } from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import { DocumentAttachmentSlots } from "../shared/DocumentAttachmentSlots";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
} from "../shared/StructuredDocument";
import { useAttachmentImageUrls } from "../shared/useAttachmentImageUrls";
import {
  useDocumentAttachmentSelection,
  useDocumentBlobAttachmentSelection,
} from "../shared/useDocumentAttachmentSelection";
import {
  DRIVER_LICENSE_ATTACHMENT_SLOTS,
  readDriverLicenseFields,
} from "./driverLicenseDocument";
import type { DriverLicenseDocumentFields } from "./driverLicenseDocumentDefinition";

function DriverLicenseFields(params: {
  fields: DriverLicenseDocumentFields;
  inputIds: {
    expirationDate: string;
    licenseId: string;
  };
  onChange: (patch: Partial<DriverLicenseDocumentFields>) => void;
  ready: boolean;
}) {
  const { fields, inputIds, onChange, ready } = params;

  return (
    <StructuredDocumentFields>
      <StructuredDocumentField
        inputId={inputIds.licenseId}
        label="License ID Number"
      >
        <input
          id={inputIds.licenseId}
          aria-label="Driver's license ID number"
          value={fields.licenseId ?? ""}
          onChange={(event) => onChange({ licenseId: event.target.value })}
          placeholder={ready ? "DL-1234567" : "Loading..."}
          disabled={!ready}
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
          value={fields.expirationDate ?? ""}
          onChange={(event) => onChange({ expirationDate: event.target.value })}
          disabled={!ready}
        />
      </StructuredDocumentField>
    </StructuredDocumentFields>
  );
}

const DRIVER_LICENSE_ATTACHMENT_COPY = {
  authenticatedOnline: "Images stay bound to fixed slots on this document.",
  localOnly: "Images save locally and sync when you're online.",
  unavailable: "Image attachments require a local key package.",
};

export function DriverLicense() {
  const { auth, infra, state } = useTearleadsRuntime();
  const { containerContents } = useTearleads();
  const { isAuthenticated } = auth;
  const { blobStore } = infra;
  const { online } = state;
  const {
    attachments,
    attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId,
    canAttach,
    ready,
    setAttachment,
    setStructuredFields,
    structuredFields,
    syncing,
  } = useDocument();
  const fields = useMemo(
    () => readDriverLicenseFields(structuredFields),
    [structuredFields],
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
  const handleSelectedBlobAttachment = useDocumentBlobAttachmentSelection({
    blobStore,
    errorMessage: "Failed to handle driver's license blob attachment selection",
    setAttachment,
  });
  const loadBlobInfo = useCallback(
    (query?: BlobInfoInput | undefined) =>
      containerContents.listBlobInfo(query),
    [containerContents],
  );

  return (
    <StructuredDocument
      attachmentCopy={DRIVER_LICENSE_ATTACHMENT_COPY}
      attachments={
        <DocumentAttachmentSlots
          attachmentStatusBySlotId={attachmentStatusBySlotId}
          attachments={attachments}
          blobPicker={{
            loadBlobInfo,
            onSelectedBlob: handleSelectedBlobAttachment,
          }}
          canAttach={canAttach}
          imageUrlBySlotId={imageUrlBySlotId}
          onSelectedAttachment={handleSelectedAttachment}
          slots={DRIVER_LICENSE_ATTACHMENT_SLOTS}
        />
      }
      canAttach={canAttach}
      fields={
        <DriverLicenseFields
          fields={fields}
          inputIds={inputIds}
          onChange={(patch) => {
            setStructuredFields("drivers_license", patch);
          }}
          ready={ready}
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
