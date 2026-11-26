import { SealCheckIcon } from "@phosphor-icons/react/dist/csr/SealCheck";
import {
  type DocumentFieldValidationIssue,
  readStringDocumentField,
  type StoredDocumentKind,
  type ValidatedDocumentFields,
} from "@tearleads/client-sdk";
import type { DocumentAttachmentSlot } from "../shared/documentAttachmentUtils";
import {
  type DocumentFieldOption,
  getDocumentFieldOptionLabel,
} from "../shared/documentFieldOptions";
import {
  addDateOnlyFormatIssue,
  addFormatIssue,
  identifierEnding,
  isValidDateOnly,
  structuredFieldsProjector,
} from "../shared/documentFieldUtils";
import type { VariantDocumentFieldDefinition } from "../shared/variantDocumentFieldModel";
import type { AppDocumentProjectorDefinition } from "../types";

export const LICENSE_DOCUMENT_KIND = "license" satisfies StoredDocumentKind;

// The hard-coded license types, in dropdown order. One kind covers every
// variant: they share the holder, issuer, number, and dates, and the type
// decides which extra fields (wildlife or firearm details) the editor offers.
// Each label names the credential, so it doubles as the title's noun.
export const LICENSE_TYPE_OPTIONS: ReadonlyArray<DocumentFieldOption> = [
  { label: "Hunting License", value: "hunting" },
  { label: "Fishing License", value: "fishing" },
  { label: "Hunting and Fishing License", value: "hunting_fishing" },
  { label: "Trapping License", value: "trapping" },
  { label: "Hunter Education Certificate", value: "hunter_education" },
  { label: "Firearm License", value: "firearm" },
  { label: "Concealed Carry Permit", value: "concealed_carry" },
  { label: "Boating License", value: "boating" },
  { label: "Other", value: "other" },
];

const RESIDENCY_OPTIONS: ReadonlyArray<DocumentFieldOption> = [
  { label: "Resident", value: "resident" },
  { label: "Nonresident", value: "nonresident" },
];

// Licenses a wildlife agency sells by season, residency, and privilege.
const WILDLIFE_TYPES = [
  "hunting",
  "fishing",
  "hunting_fishing",
  "trapping",
] as const;
// Wildlife agencies key a person's licenses and hunter education to one
// customer number, separate from each license's own number.
const CUSTOMER_ID_TYPES = [...WILDLIFE_TYPES, "hunter_education"] as const;
const FIREARM_TYPES = ["firearm", "concealed_carry"] as const;

export const LICENSE_FIELDS = [
  { key: "holderName", label: "Holder" },
  { key: "jurisdiction", label: "Issued In", placeholder: "Montana" },
  {
    key: "issuer",
    label: "Issuing Agency",
    placeholder: "Fish, Wildlife and Parks",
  },
  { key: "licenseNumber", label: "License Number" },
  { key: "customerId", label: "Customer ID", variants: CUSTOMER_ID_TYPES },
  {
    key: "residency",
    label: "Residency",
    options: RESIDENCY_OPTIONS,
    placeholder: "Select residency",
    variants: WILDLIFE_TYPES,
  },
  {
    key: "privileges",
    label: "Privileges and Stamps",
    placeholder: "Deer archery, trout stamp",
    variants: WILDLIFE_TYPES,
  },
  {
    key: "restrictions",
    label: "Class or Restrictions",
    placeholder: "Handguns only",
    variants: FIREARM_TYPES,
  },
  { key: "issueDate", label: "Issue Date", type: "date" },
  { key: "expirationDate", label: "Expiration Date", type: "date" },
] as const satisfies ReadonlyArray<VariantDocumentFieldDefinition>;

type LicenseFieldDefinition = (typeof LICENSE_FIELDS)[number];
type LicenseFieldKey = LicenseFieldDefinition["key"];

export type LicenseDocumentFields = Record<
  LicenseFieldKey | "licenseType",
  string
>;

const NUMBER_LABEL_BY_LICENSE_TYPE: Readonly<Record<string, string>> = {
  concealed_carry: "Permit Number",
  hunter_education: "Certificate Number",
};

/** The label a field takes for the document's license type. */
export function getLicenseFieldLabel(
  field: LicenseFieldDefinition,
  licenseType: string,
): string {
  return field.key === "licenseNumber"
    ? (NUMBER_LABEL_BY_LICENSE_TYPE[licenseType.trim()] ?? field.label)
    : field.label;
}

export function readLicenseFields(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<LicenseDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  const read = (key: string) => readStringDocumentField(source, key, issues);
  const fields: LicenseDocumentFields = {
    licenseType: read("licenseType"),
    holderName: read("holderName"),
    jurisdiction: read("jurisdiction"),
    issuer: read("issuer"),
    licenseNumber: read("licenseNumber"),
    customerId: read("customerId"),
    residency: read("residency"),
    privileges: read("privileges"),
    restrictions: read("restrictions"),
    issueDate: read("issueDate"),
    expirationDate: read("expirationDate"),
  };

  addDateOnlyFormatIssue(issues, "issueDate", fields.issueDate);
  addDateOnlyFormatIssue(issues, "expirationDate", fields.expirationDate);
  // Valid dates are YYYY-MM-DD, so string order is calendar order.
  if (
    isValidDateOnly(fields.issueDate) &&
    isValidDateOnly(fields.expirationDate) &&
    fields.expirationDate < fields.issueDate
  ) {
    addFormatIssue(
      issues,
      "expirationDate",
      fields.expirationDate,
      "Expected an expiration date on or after the issue date.",
    );
  }

  return { fields, issues };
}

export function readLicenseFieldValues(
  source: Readonly<Record<string, unknown>>,
): LicenseDocumentFields {
  return readLicenseFields(source).fields;
}

const untitledTitle = "Untitled license";

// "Montana Hunting License": where it was issued and its type, degrading to
// whichever of the two is set, then to the last four characters of the license
// number or customer ID (never a whole identifier: see identifierEnding), then
// to the untitled title. A type a newer client wrote reads as its humanized
// value.
function deriveLicenseTitle(fields: LicenseDocumentFields): string {
  const licenseType = fields.licenseType.trim();
  const typeLabel =
    licenseType === "other"
      ? ""
      : getDocumentFieldOptionLabel(LICENSE_TYPE_OPTIONS, licenseType);
  const jurisdiction = fields.jurisdiction.trim();
  if (typeLabel.length > 0 || jurisdiction.length > 0) {
    return [jurisdiction, typeLabel || "License"]
      .filter((part) => part.length > 0)
      .join(" ");
  }

  const ending = identifierEnding(fields.licenseNumber, fields.customerId);
  return ending.length > 0 ? `License ending ${ending}` : untitledTitle;
}

export const LICENSE_SLOTS: ReadonlyArray<DocumentAttachmentSlot> = [
  { label: "Front", slotId: "front" },
  { label: "Back", slotId: "back" },
  {
    accept: "image-or-pdf",
    itemLabel: "License Document",
    label: "License Documents",
    multiple: true,
    slotId: "license-documents",
  },
];

export const licenseDocumentProjectorDefinition = {
  createIcon: SealCheckIcon,
  createLabel: "License or Permit",
  kind: LICENSE_DOCUMENT_KIND,
  label: "license",
  project: structuredFieldsProjector(readLicenseFields, deriveLicenseTitle),
  untitledTitle,
} satisfies AppDocumentProjectorDefinition;
