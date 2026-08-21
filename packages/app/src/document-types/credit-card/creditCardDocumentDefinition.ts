import { CreditCardIcon } from "@phosphor-icons/react/dist/csr/CreditCard";
import {
  type DocumentFieldValidationIssue,
  readStringDocumentField,
  type StoredDocumentKind,
  type ValidatedDocumentFields,
} from "@symcrypt/client-sdk";
import {
  addFormatIssue,
  structuredFieldsProjector,
} from "../shared/documentFieldUtils";
import type { AppDocumentProjectorDefinition } from "../types";

export const CREDIT_CARD_DOCUMENT_KIND =
  "credit_card" satisfies StoredDocumentKind;

export type CreditCardDocumentFields = {
  cardNumber: string;
  cvvCode: string;
  expirationDate: string;
  issuer: string;
  nameOnCard: string;
};

const CREDIT_CARD_EXPIRATION_PATTERN = /^\d{4}-\d{2}$/u;

function isValidYearMonth(value: string): boolean {
  if (!CREDIT_CARD_EXPIRATION_PATTERN.test(value)) {
    return false;
  }

  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

/**
 * The name a card shows under, in the Explorer and everywhere else a document
 * title appears.
 *
 * The issuer leads it because that is what tells two cards apart at a glance,
 * and the last four digits are what a holder checks against the physical card.
 * Each part is optional, so the title degrades a step at a time rather than
 * falling straight to "Untitled": issuer and digits, then whichever one is
 * known, then the name on the card.
 */
function deriveCreditCardTitle(fields: CreditCardDocumentFields): string {
  const issuer = fields.issuer.trim();
  const digits = fields.cardNumber.replaceAll(/\D/gu, "");
  if (digits.length >= 4) {
    const label = issuer.length > 0 ? issuer : "Credit Card";
    return `${label} ending in ${digits.slice(-4)}`;
  }

  if (issuer.length > 0) {
    return issuer;
  }

  const trimmedNameOnCard = fields.nameOnCard.trim();
  return trimmedNameOnCard.length > 0
    ? `Credit Card ${trimmedNameOnCard}`
    : "Untitled credit card";
}

export function readCreditCardFieldsFromRecord(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<CreditCardDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  const fields = {
    cardNumber: readStringDocumentField(source, "cardNumber", issues),
    cvvCode: readStringDocumentField(source, "cvvCode", issues),
    expirationDate: readStringDocumentField(source, "expirationDate", issues),
    issuer: readStringDocumentField(source, "issuer", issues),
    nameOnCard: readStringDocumentField(source, "nameOnCard", issues),
  };
  const { expirationDate } = fields;
  if (expirationDate.length > 0 && !isValidYearMonth(expirationDate)) {
    addFormatIssue(
      issues,
      "expirationDate",
      expirationDate,
      "Expected a card expiration month in YYYY-MM format.",
    );
  }
  return { fields, issues };
}

export const creditCardDocumentProjectorDefinition: AppDocumentProjectorDefinition =
  {
    createIcon: CreditCardIcon,
    createLabel: "Credit Card",
    kind: CREDIT_CARD_DOCUMENT_KIND,
    label: "credit card",
    project: structuredFieldsProjector(
      readCreditCardFieldsFromRecord,
      deriveCreditCardTitle,
    ),
    untitledTitle: "Untitled credit card",
  };
