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
import { useDocumentAttachmentSelection } from "../shared/useDocumentAttachmentSelection";
import {
  DRIVER_LICENSE_ATTACHMENT_SLOTS,
  readDriverLicenseFields,
} from "./driverLicenseDocument";

const DRIVER_LICENSE_ATTACHMENT_COPY = {
  authenticatedOnline: "Images stay bound to fixed slots on this document.",
  localOnly: "Images save locally and sync when you're online.",
  unavailable: "Image attachments require a local key package.",
};

export function DriverLicense() {
  const { blobStore, isAuthenticated, online } = useTearleadsRuntime();
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
  const expirationDateInputId = useId();
  const licenseIdInputId = useId();
  const imageUrlBySlotId = useAttachmentImageUrls(
    attachments,
    attachmentStorageKeyBySlotId,
    blobStore,
  );
  const handleSelectedAttachment = useDocumentAttachmentSelection({
    errorMessage: "Failed to handle driver's license attachment selection",
    setAttachment,
  });

  return (
    <StructuredDocument
      attachmentCopy={DRIVER_LICENSE_ATTACHMENT_COPY}
      attachments={
        <DocumentAttachmentSlots
          attachmentStatusBySlotId={attachmentStatusBySlotId}
          attachments={attachments}
          canAttach={canAttach}
          imageUrlBySlotId={imageUrlBySlotId}
          onSelectedAttachment={handleSelectedAttachment}
          slots={DRIVER_LICENSE_ATTACHMENT_SLOTS}
        />
      }
      canAttach={canAttach}
      fields={
        <StructuredDocumentFields>
          <StructuredDocumentField
            inputId={licenseIdInputId}
            label="License ID Number"
          >
            <input
              id={licenseIdInputId}
              aria-label="Driver's license ID number"
              value={fields.licenseId}
              onChange={(event) =>
                setStructuredFields("drivers_license", {
                  licenseId: event.target.value,
                })
              }
              placeholder={ready ? "DL-1234567" : "Loading..."}
              disabled={!ready}
            />
          </StructuredDocumentField>
          <StructuredDocumentField
            inputId={expirationDateInputId}
            label="Expiration Date"
          >
            <input
              id={expirationDateInputId}
              aria-label="Driver's license expiration date"
              type="date"
              value={fields.expirationDate}
              onChange={(event) =>
                setStructuredFields("drivers_license", {
                  expirationDate: event.target.value,
                })
              }
              disabled={!ready}
            />
          </StructuredDocumentField>
        </StructuredDocumentFields>
      }
      isAuthenticated={isAuthenticated}
      online={online}
      ready={ready}
      syncing={syncing}
      title="Driver's License"
    />
  );
}
