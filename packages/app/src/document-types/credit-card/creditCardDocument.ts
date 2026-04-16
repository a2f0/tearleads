import type { DocumentAttachment } from "../../data/documents/documentContent";
import {
  type CreditCardDocumentFields,
  parseCreditCardDocument,
  serializeCreditCardDocument,
} from "../../data/documents/documentKinds";

interface CreditCardAttachmentSlot {
  description: string;
  label: string;
  slotId: string;
}

export const CREDIT_CARD_FRONT_IMAGE_SLOT_ID = "credit-card-front-image";
const CREDIT_CARD_BACK_IMAGE_SLOT_ID = "credit-card-back-image";

export const CREDIT_CARD_ATTACHMENT_SLOTS: ReadonlyArray<CreditCardAttachmentSlot> =
  [
    {
      description: "Opaque slot binding for the front image.",
      label: "Front Image",
      slotId: CREDIT_CARD_FRONT_IMAGE_SLOT_ID,
    },
    {
      description: "Opaque slot binding for the back image.",
      label: "Back Image",
      slotId: CREDIT_CARD_BACK_IMAGE_SLOT_ID,
    },
  ];

export function createEmptyCreditCardDocument(): string {
  return serializeCreditCardDocument({
    cardNumber: "",
    cvvCode: "",
    expirationDate: "",
    nameOnCard: "",
  });
}

export function parseCreditCardFields(text: string): CreditCardDocumentFields {
  return (
    parseCreditCardDocument(text) ?? {
      cardNumber: "",
      cvvCode: "",
      expirationDate: "",
      nameOnCard: "",
    }
  );
}

export function updateCreditCardFields(
  currentText: string,
  patch: Partial<CreditCardDocumentFields>,
): string {
  return serializeCreditCardDocument({
    ...parseCreditCardFields(currentText),
    ...patch,
  });
}

export function getCreditCardAttachmentBySlotId(
  attachments: ReadonlyArray<DocumentAttachment>,
  slotId: string,
): DocumentAttachment | null {
  return (
    attachments.findLast((attachment) => attachment.slotId === slotId) ?? null
  );
}
