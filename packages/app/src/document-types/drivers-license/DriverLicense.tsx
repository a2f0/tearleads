import { type ChangeEvent, useEffect, useId, useMemo, useRef } from "react";
import { useAppData } from "../../data/AppDataProvider";
import type { BlobBytes } from "../../data/blobs";
import {
  type DocumentAttachmentStatus,
  useDocument,
} from "../../data/documents/DocumentsProvider";
import { useAttachmentImageUrls } from "../../data/documents/useAttachmentImageUrls";
import { formatByteLength } from "../../utils/formatByteLength";
import {
  createEmptyDriverLicenseDocument,
  DRIVER_LICENSE_ATTACHMENT_SLOTS,
  getDriverLicenseAttachmentBySlotId,
  parseDriverLicenseFields,
  updateDriverLicenseFields,
} from "./driverLicenseDocument";
import "./DriverLicense.css";

interface DriverLicenseAttachmentUpload {
  bytes: BlobBytes;
  mimeType: string | null;
  name: string;
}

async function readAttachmentUpload(
  file: File,
): Promise<DriverLicenseAttachmentUpload> {
  return {
    bytes: new Uint8Array(await file.arrayBuffer()) as BlobBytes,
    mimeType: file.type.length > 0 ? file.type : null,
    name: file.name,
  };
}

function getAttachmentStatusLabel(
  status: DocumentAttachmentStatus | undefined,
): string | null {
  if (status === "needs_replacement") {
    return "Replace this image to finish the access change.";
  }

  if (status === "syncing") {
    return "Syncing image.";
  }

  return null;
}

function DriverLicenseSlotCard(params: {
  canAttach: boolean;
  imageUrl: string | undefined;
  onSelectedFile: (fileList: FileList | null) => void;
  slot: (typeof DRIVER_LICENSE_ATTACHMENT_SLOTS)[number];
  status: DocumentAttachmentStatus | undefined;
  storedAttachment: ReturnType<typeof getDriverLicenseAttachmentBySlotId>;
}) {
  const {
    canAttach,
    imageUrl,
    onSelectedFile,
    slot,
    status,
    storedAttachment,
  } = params;
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const statusLabel = getAttachmentStatusLabel(status);

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    onSelectedFile(event.currentTarget.files);
    event.currentTarget.value = "";
  }

  return (
    <section className="driver-license-slot">
      <div className="driver-license-slot-copy">
        <strong>{slot.label}</strong>
        <span className="driver-license-slot-description">
          {slot.description}
        </span>
      </div>
      {imageUrl ? (
        <img
          className="driver-license-slot-preview"
          src={imageUrl}
          alt={storedAttachment?.name ?? slot.label}
        />
      ) : (
        <div className="driver-license-slot-preview driver-license-slot-placeholder">
          No image selected
        </div>
      )}
      <div className="driver-license-slot-meta">
        <span className="driver-license-slot-name">
          {storedAttachment?.name ?? "No file selected"}
        </span>
        <span className="driver-license-slot-detail">
          {storedAttachment
            ? formatByteLength(storedAttachment.byteLength)
            : "Attach a file to bind this slot."}
        </span>
      </div>
      <div className="driver-license-slot-actions">
        <button
          type="button"
          className="driver-license-slot-button"
          disabled={!canAttach}
          onClick={() => inputRef.current?.click()}
        >
          {storedAttachment ? "Replace Image" : "Select Image"}
        </button>
        {statusLabel ? (
          <span className="driver-license-slot-status">{statusLabel}</span>
        ) : null}
      </div>
      <input
        id={inputId}
        ref={inputRef}
        className="driver-license-file-input"
        type="file"
        accept="image/*"
        disabled={!canAttach}
        onChange={handleInputChange}
      />
    </section>
  );
}

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
  const imageUrlBySlotId = useAttachmentImageUrls(
    attachments,
    attachmentStorageKeyBySlotId,
    blobStore,
  );

  useEffect(() => {
    if (ready && text.trim().length === 0) {
      setText(createEmptyDriverLicenseDocument());
    }
  }, [ready, setText, text]);

  async function handleSelectedAttachment(
    slotId: string,
    fileList: FileList | null,
  ) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    const [file] = Array.from(fileList);
    if (!file) {
      return;
    }

    setAttachment(slotId, await readAttachmentUpload(file));
  }

  return (
    <div className="driver-license">
      <div className="driver-license-header">
        <div className="driver-license-title">
          <strong>Driver&apos;s License</strong>
          <span className="driver-license-status">
            {!ready ? "Loading..." : syncing ? "Syncing..." : "Ready"}
          </span>
        </div>
        <span className="driver-license-status">
          {canAttach
            ? isAuthenticated && online
              ? "Images stay bound to fixed slots on this document."
              : "Images save locally and sync when you're online."
            : "Image attachments require a local key package."}
        </span>
      </div>
      <div className="driver-license-fields">
        <label className="driver-license-field">
          License ID Number
          <input
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
        </label>
        <label className="driver-license-field">
          Expiration Date
          <input
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
        </label>
      </div>
      <div className="driver-license-attachments">
        {DRIVER_LICENSE_ATTACHMENT_SLOTS.map((slot) => {
          const storedAttachment = getDriverLicenseAttachmentBySlotId(
            attachments,
            slot.slotId,
          );

          return (
            <DriverLicenseSlotCard
              key={slot.slotId}
              canAttach={canAttach}
              imageUrl={imageUrlBySlotId[slot.slotId]}
              onSelectedFile={(fileList) => {
                void handleSelectedAttachment(slot.slotId, fileList);
              }}
              slot={slot}
              status={attachmentStatusBySlotId[slot.slotId]}
              storedAttachment={storedAttachment}
            />
          );
        })}
      </div>
    </div>
  );
}
