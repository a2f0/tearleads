import { CertificateIcon } from "@phosphor-icons/react/dist/csr/Certificate";
import {
  type DocumentFieldValidationIssue,
  readStringDocumentField,
  type StoredDocumentKind,
  type ValidatedDocumentFields,
} from "@tearleads/client-sdk";
import {
  addDateOnlyFormatIssue,
  structuredFieldsProjector,
} from "../shared/documentFieldUtils";
import type { AppDocumentProjectorDefinition } from "../types";

export const BIRTH_CERTIFICATE_DOCUMENT_KIND =
  "birth_certificate" satisfies StoredDocumentKind;

export type BirthCertificateDocumentFields = {
  certificateNumber: string;
  fullName: string;
  dateOfBirth: string;
  placeOfBirth: string;
  parentNames: string;
  issuingAuthority: string;
  dateIssued: string;
};

function deriveBirthCertificateTitle(
  fields: BirthCertificateDocumentFields,
): string {
  const name = fields.fullName.trim();
  const number = fields.certificateNumber.trim();
  return name || number
    ? `Birth Certificate ${name || number}`
    : "Untitled birth certificate";
}

export function readBirthCertificateFieldsFromRecord(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<BirthCertificateDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  const fields = {
    certificateNumber: readStringDocumentField(
      source,
      "certificateNumber",
      issues,
    ),
    fullName: readStringDocumentField(source, "fullName", issues),
    dateOfBirth: readStringDocumentField(source, "dateOfBirth", issues),
    placeOfBirth: readStringDocumentField(source, "placeOfBirth", issues),
    parentNames: readStringDocumentField(source, "parentNames", issues),
    issuingAuthority: readStringDocumentField(
      source,
      "issuingAuthority",
      issues,
    ),
    dateIssued: readStringDocumentField(source, "dateIssued", issues),
  };
  addDateOnlyFormatIssue(issues, "dateOfBirth", fields.dateOfBirth);
  addDateOnlyFormatIssue(issues, "dateIssued", fields.dateIssued);
  return { fields, issues };
}

export const birthCertificateDocumentProjectorDefinition: AppDocumentProjectorDefinition =
  {
    createIcon: CertificateIcon,
    createLabel: "Birth Certificate",
    kind: BIRTH_CERTIFICATE_DOCUMENT_KIND,
    label: "birth certificate",
    project: structuredFieldsProjector(
      readBirthCertificateFieldsFromRecord,
      deriveBirthCertificateTitle,
    ),
    untitledTitle: "Untitled birth certificate",
  };
