import {
  type DriverLicenseDocumentFields,
  parseDriverLicenseDocument,
  serializeDriverLicenseDocument,
} from "../../data/documents/documentKinds";
import {
  createFrontAndBackImageSlots,
  type DocumentAttachmentSlot,
} from "../shared/documentAttachmentUtils";

export const DRIVER_LICENSE_FRONT_IMAGE_SLOT_ID = "driver-license-front-image";
const DRIVER_LICENSE_BACK_IMAGE_SLOT_ID = "driver-license-back-image";

export const DRIVER_LICENSE_ATTACHMENT_SLOTS: ReadonlyArray<DocumentAttachmentSlot> =
  createFrontAndBackImageSlots({
    backSlotId: DRIVER_LICENSE_BACK_IMAGE_SLOT_ID,
    frontSlotId: DRIVER_LICENSE_FRONT_IMAGE_SLOT_ID,
  });

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
