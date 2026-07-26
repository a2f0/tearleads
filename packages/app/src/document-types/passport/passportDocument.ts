import type { DocumentAttachmentSlot } from "../shared/documentAttachmentUtils";
import {
  type PassportDocumentFields,
  readPassportFieldsFromRecord,
} from "./passportDocumentDefinition";

const PASSPORT_IMAGE_SLOT_ID = "passport-image";

export const PASSPORT_ATTACHMENT_SLOTS: ReadonlyArray<DocumentAttachmentSlot> =
  [
    {
      label: "Passport Image",
      slotId: PASSPORT_IMAGE_SLOT_ID,
    },
  ];

export type { PassportDocumentFields };

export function readPassportFields(
  fields: Readonly<Record<string, unknown>>,
): PassportDocumentFields {
  return readPassportFieldsFromRecord(fields).fields;
}
