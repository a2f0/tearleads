import { BookOpenUserIcon } from "@phosphor-icons/react/dist/csr/BookOpenUser";
import {
  type DocumentFieldValidationIssue,
  readStringDocumentField,
  type StoredDocumentKind,
  type ValidatedDocumentFields,
} from "@tearleads/client-sdk";
import { addDateOnlyFormatIssue } from "../shared/documentFieldUtils";
import type { AppDocumentProjectorDefinition } from "../types";

export const PASSPORT_DOCUMENT_KIND = "passport" satisfies StoredDocumentKind;

export interface PassportDocumentFields {
  expirationDate: string;
  fullName: string;
  issuingCountry: string;
  passportNumber: string;
}

function derivePassportTitle(fields: PassportDocumentFields): string {
  const trimmedPassportNumber = fields.passportNumber.trim();
  if (trimmedPassportNumber.length > 0) {
    return `Passport ${trimmedPassportNumber}`;
  }

  const trimmedFullName = fields.fullName.trim();
  return trimmedFullName.length > 0
    ? `Passport ${trimmedFullName}`
    : "Untitled passport";
}

export function readPassportFieldsFromRecord(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<PassportDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  const fields = {
    expirationDate: readStringDocumentField(source, "expirationDate", issues),
    fullName: readStringDocumentField(source, "fullName", issues),
    issuingCountry: readStringDocumentField(source, "issuingCountry", issues),
    passportNumber: readStringDocumentField(source, "passportNumber", issues),
  };

  addDateOnlyFormatIssue(issues, "expirationDate", fields.expirationDate);

  return { fields, issues };
}

export const passportDocumentProjectorDefinition: AppDocumentProjectorDefinition =
  {
    createIcon: BookOpenUserIcon,
    createLabel: "Passport",
    kind: PASSPORT_DOCUMENT_KIND,
    label: "passport",
    project: ({ structuredFields }) => {
      const validated = readPassportFieldsFromRecord(structuredFields);
      return {
        fieldValidationIssues: validated.issues,
        structuredFields: { ...validated.fields },
        title: derivePassportTitle(validated.fields),
      };
    },
    untitledTitle: "Untitled passport",
  };
