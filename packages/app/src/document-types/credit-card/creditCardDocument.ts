import {
  type CreditCardDocumentFields,
  readCreditCardFieldsFromRecord,
} from "../../data/documents/documentKinds";
import {
  createFrontAndBackImageSlots,
  type DocumentAttachmentSlot,
} from "../shared/documentAttachmentUtils";

const CREDIT_CARD_FRONT_IMAGE_SLOT_ID = "credit-card-front-image";
const CREDIT_CARD_BACK_IMAGE_SLOT_ID = "credit-card-back-image";

export const CREDIT_CARD_ATTACHMENT_SLOTS: ReadonlyArray<DocumentAttachmentSlot> =
  createFrontAndBackImageSlots({
    backSlotId: CREDIT_CARD_BACK_IMAGE_SLOT_ID,
    frontSlotId: CREDIT_CARD_FRONT_IMAGE_SLOT_ID,
  });

export function readCreditCardFields(
  fields: Readonly<Record<string, unknown>>,
): CreditCardDocumentFields {
  return readCreditCardFieldsFromRecord(fields).fields;
}
