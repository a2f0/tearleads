import {
  type DriverLicenseDocumentFields,
  readDriverLicenseFieldsFromRecord,
} from "../../data/documents/documentKinds";
import {
  createFrontAndBackImageSlots,
  type DocumentAttachmentSlot,
} from "../shared/documentAttachmentUtils";

const DRIVER_LICENSE_FRONT_IMAGE_SLOT_ID = "driver-license-front-image";
const DRIVER_LICENSE_BACK_IMAGE_SLOT_ID = "driver-license-back-image";

export const DRIVER_LICENSE_ATTACHMENT_SLOTS: ReadonlyArray<DocumentAttachmentSlot> =
  createFrontAndBackImageSlots({
    backSlotId: DRIVER_LICENSE_BACK_IMAGE_SLOT_ID,
    frontSlotId: DRIVER_LICENSE_FRONT_IMAGE_SLOT_ID,
  });

export function readDriverLicenseFields(
  fields: Readonly<Record<string, unknown>>,
): DriverLicenseDocumentFields {
  return readDriverLicenseFieldsFromRecord(fields).fields;
}
