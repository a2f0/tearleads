import { createDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { CreditCard } from "./CreditCard";
import { CREDIT_CARD_DOCUMENT_KIND } from "./creditCardDocumentDefinition";

export const CreditCardDocumentApp = createDocumentTypeApp(
  CREDIT_CARD_DOCUMENT_KIND,
  CreditCard,
);
