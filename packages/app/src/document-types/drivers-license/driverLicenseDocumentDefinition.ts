import { IdentificationCardIcon } from "@phosphor-icons/react/dist/csr/IdentificationCard";
import {
  type DocumentFieldValidationIssue,
  readStringDocumentField,
  type StoredDocumentKind,
  type ValidatedDocumentFields,
} from "@tearleads/client-sdk";
import { addDateOnlyFormatIssue } from "../shared/documentFieldUtils";
import type { AppDocumentProjectorDefinition } from "../types";

export const DRIVER_LICENSE_DOCUMENT_KIND =
  "drivers_license" satisfies StoredDocumentKind;

export interface DriverLicenseDocumentFields {
  expirationDate: string;
  licenseId: string;
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

  addDateOnlyFormatIssue(issues, "expirationDate", fields.expirationDate);

  return { fields, issues };
}

export const driverLicenseDocumentProjectorDefinition: AppDocumentProjectorDefinition =
  {
    createIcon: IdentificationCardIcon,
    createLabel: "Driver's License",
    kind: DRIVER_LICENSE_DOCUMENT_KIND,
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
