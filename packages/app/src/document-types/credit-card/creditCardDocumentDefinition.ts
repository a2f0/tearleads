import {
  type DocumentFieldValidationIssue,
  readStringDocumentField,
  type ValidatedDocumentFields,
} from "@tearleads/client-sdk";
import { addFormatIssue } from "../shared/documentFieldUtils";
import type { AppDocumentProjectorDefinition } from "../types";

export interface CreditCardDocumentFields {
  cardNumber: string;
  cvvCode: string;
  expirationDate: string;
  nameOnCard: string;
}

const CREDIT_CARD_EXPIRATION_PATTERN = /^\d{4}-\d{2}$/u;

function isValidYearMonth(value: string): boolean {
  if (!CREDIT_CARD_EXPIRATION_PATTERN.test(value)) {
    return false;
  }

  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

function deriveCreditCardTitle(fields: CreditCardDocumentFields): string {
  const digits = fields.cardNumber.replaceAll(/\D/gu, "");
  if (digits.length >= 4) {
    return `Credit Card ending in ${digits.slice(-4)}`;
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
    nameOnCard: readStringDocumentField(source, "nameOnCard", issues),
  };

  if (
    fields.expirationDate.length > 0 &&
    !isValidYearMonth(fields.expirationDate)
  ) {
    addFormatIssue(
      issues,
      "expirationDate",
      fields.expirationDate,
      "Expected a card expiration month in YYYY-MM format.",
    );
  }

  return { fields, issues };
}

export const creditCardDocumentProjectorDefinition: AppDocumentProjectorDefinition =
  {
    createLabel: "New Credit Card",
    kind: "credit_card",
    label: "credit card",
    project: ({ structuredFields }) => {
      const validated = readCreditCardFieldsFromRecord(structuredFields);
      return {
        fieldValidationIssues: validated.issues,
        structuredFields: { ...validated.fields },
        title: deriveCreditCardTitle(validated.fields),
      };
    },
    untitledTitle: "Untitled credit card",
  };
