import {
  createDocumentProjectorRegistry,
  type DocumentFieldValidationIssue,
  type DocumentProjectorDefinition,
  readStringDocumentField,
  type ValidatedDocumentFields,
} from "@tearleads/client-sdk/documents";

export interface DriverLicenseDocumentFields {
  expirationDate: string;
  licenseId: string;
}

export interface CreditCardDocumentFields {
  cardNumber: string;
  cvvCode: string;
  expirationDate: string;
  nameOnCard: string;
}

interface AppDocumentProjectorDefinition extends DocumentProjectorDefinition {
  createLabel: string;
}

const DRIVER_LICENSE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CREDIT_CARD_EXPIRATION_PATTERN = /^\d{4}-\d{2}$/u;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function getDaysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isValidDateOnly(value: string): boolean {
  if (!DRIVER_LICENSE_DATE_PATTERN.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  return day <= getDaysInMonth(year, month);
}

function isValidYearMonth(value: string): boolean {
  if (!CREDIT_CARD_EXPIRATION_PATTERN.test(value)) {
    return false;
  }

  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

function addFormatIssue(
  issues: DocumentFieldValidationIssue[],
  field: string,
  value: string,
  message: string,
): void {
  if (value.length === 0) {
    return;
  }

  issues.push({
    field,
    message,
    value,
  });
}

function deriveNoteTitle(text: string): string {
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return "Untitled note";
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

function deriveDriverLicenseTitle(fields: DriverLicenseDocumentFields): string {
  const trimmedLicenseId = fields.licenseId.trim();
  return trimmedLicenseId.length > 0
    ? `Driver's License ${trimmedLicenseId}`
    : "Untitled driver's license";
}

export function readDriverLicenseFieldsFromRecord(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<DriverLicenseDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  const fields = {
    expirationDate: readStringDocumentField(source, "expirationDate", issues),
    licenseId: readStringDocumentField(source, "licenseId", issues),
  };

  if (
    fields.expirationDate.length > 0 &&
    !isValidDateOnly(fields.expirationDate)
  ) {
    addFormatIssue(
      issues,
      "expirationDate",
      fields.expirationDate,
      "Expected a calendar date in YYYY-MM-DD format.",
    );
  }

  return { fields, issues };
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

export const APP_DOCUMENT_PROJECTOR_DEFINITIONS: ReadonlyArray<AppDocumentProjectorDefinition> =
  [
    {
      createLabel: "New Note",
      kind: "note",
      label: "note",
      project: ({ text }) => ({
        fieldValidationIssues: [],
        structuredFields: {},
        title: deriveNoteTitle(text),
      }),
      untitledTitle: "Untitled note",
    },
    {
      createLabel: "New Driver's License",
      kind: "drivers_license",
      label: "driver's license",
      project: ({ structuredFields }) => {
        const validated = readDriverLicenseFieldsFromRecord(structuredFields);
        return {
          fieldValidationIssues: validated.issues,
          structuredFields: { ...validated.fields },
          title: deriveDriverLicenseTitle(validated.fields),
        };
      },
      untitledTitle: "Untitled driver's license",
    },
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
    },
  ];

export const APP_DOCUMENT_PROJECTOR_REGISTRY = createDocumentProjectorRegistry(
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
);
