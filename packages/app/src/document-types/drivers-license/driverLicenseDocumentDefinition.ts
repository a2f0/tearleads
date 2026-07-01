import { IdentificationCardIcon } from "@phosphor-icons/react/dist/csr/IdentificationCard";
import {
  type DocumentFieldValidationIssue,
  readStringDocumentField,
  type ValidatedDocumentFields,
} from "@tearleads/client-sdk";
import { addFormatIssue } from "../shared/documentFieldUtils";
import type { AppDocumentProjectorDefinition } from "../types";

export interface DriverLicenseDocumentFields {
  expirationDate: string;
  licenseId: string;
}

const DRIVER_LICENSE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

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

export const driverLicenseDocumentProjectorDefinition: AppDocumentProjectorDefinition =
  {
    createIcon: IdentificationCardIcon,
    createLabel: "Driver's License",
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
  };
