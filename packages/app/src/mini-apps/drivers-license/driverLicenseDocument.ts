import {
  type DriverLicenseDocumentFields,
  parseDriverLicenseDocument,
  serializeDriverLicenseDocument,
} from "../documents/documentKinds";
import type { NoteAttachment } from "../notes/noteDocument";

interface DriverLicenseAttachmentSlot {
  description: string;
  label: string;
  slotId: string;
}

export const DRIVER_LICENSE_FRONT_IMAGE_SLOT_ID = "driver-license-front-image";
const DRIVER_LICENSE_BACK_IMAGE_SLOT_ID = "driver-license-back-image";

export const DRIVER_LICENSE_ATTACHMENT_SLOTS: ReadonlyArray<DriverLicenseAttachmentSlot> =
  [
    {
      description: "Opaque slot binding for the front image.",
      label: "Front Image",
      slotId: DRIVER_LICENSE_FRONT_IMAGE_SLOT_ID,
    },
    {
      description: "Opaque slot binding for the back image.",
      label: "Back Image",
      slotId: DRIVER_LICENSE_BACK_IMAGE_SLOT_ID,
    },
  ];

export function createEmptyDriverLicenseDocument(): string {
  return serializeDriverLicenseDocument({
    expirationDate: "",
    licenseId: "",
  });
}

export function parseDriverLicenseFields(
  text: string,
): DriverLicenseDocumentFields {
  return (
    parseDriverLicenseDocument(text) ?? {
      expirationDate: "",
      licenseId: "",
    }
  );
}

export function updateDriverLicenseFields(
  currentText: string,
  patch: Partial<DriverLicenseDocumentFields>,
): string {
  return serializeDriverLicenseDocument({
    ...parseDriverLicenseFields(currentText),
    ...patch,
  });
}

export function getDriverLicenseAttachmentBySlotId(
  attachments: ReadonlyArray<NoteAttachment>,
  slotId: string,
): NoteAttachment | null {
  return attachments.find((attachment) => attachment.slotId === slotId) ?? null;
}
