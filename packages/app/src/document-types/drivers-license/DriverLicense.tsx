import { useEffect, useId, useMemo } from "react";
import { useDocument } from "../../data/documents/DocumentsProvider";
import { useAttachmentImageUrls } from "../../data/documents/useAttachmentImageUrls";
import { useAppData } from "../../providers/data/AppDataProvider";
import { DocumentAttachmentSlots } from "../shared/DocumentAttachmentSlots";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
} from "../shared/StructuredDocument";
import { useDocumentAttachmentSelection } from "../shared/useDocumentAttachmentSelection";
import {
  createEmptyDriverLicenseDocument,
  DRIVER_LICENSE_ATTACHMENT_SLOTS,
  parseDriverLicenseFields,
  updateDriverLicenseFields,
} from "./driverLicenseDocument";

const DRIVER_LICENSE_ATTACHMENT_COPY = {
  authenticatedOnline: "Images stay bound to fixed slots on this document.",
  localOnly: "Images save locally and sync when you're online.",
  unavailable: "Image attachments require a local key package.",
};

export function DriverLicense() {
  const { blobStore, isAuthenticated, online } = useAppData();
  const {
    attachments,
    attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId,
    canAttach,
    ready,
    setAttachment,
    setText,
    syncing,
    text,
  } = useDocument();
  const fields = useMemo(() => parseDriverLicenseFields(text), [text]);
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

  useEffect(() => {
    if (ready && text.trim().length === 0) {
      setText(createEmptyDriverLicenseDocument());
    }
  }, [ready, setText, text]);

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
                setText(
                  updateDriverLicenseFields(text, {
                    licenseId: event.target.value,
                  }),
                )
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
                setText(
                  updateDriverLicenseFields(text, {
                    expirationDate: event.target.value,
                  }),
                )
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
