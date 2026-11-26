import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";
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
  structuredFieldsProjector,
} from "../shared/documentFieldUtils";
import type { VariantDocumentFieldDefinition } from "../shared/variantDocumentFieldModel";
import type { AppDocumentProjectorDefinition } from "../types";

export const INSURANCE_POLICY_DOCUMENT_KIND =
  "insurance_policy" satisfies StoredDocumentKind;

// The hard-coded policy types, in dropdown order. One kind covers every
// variant: they share most fields, and the type decides which extra fields
// (member and prescription details) the editor offers.
export const INSURANCE_POLICY_TYPE_OPTIONS: ReadonlyArray<DocumentFieldOption> =
  [
    { label: "Health", value: "health" },
    { label: "Dental", value: "dental" },
    { label: "Vision", value: "vision" },
    { label: "Auto", value: "auto" },
    { label: "Home", value: "home" },
    { label: "Renters", value: "renters" },
    { label: "Life", value: "life" },
    { label: "Other", value: "other" },
  ];

const MEMBER_PLAN_TYPES = ["health", "dental", "vision"] as const;
const PRESCRIPTION_PLAN_TYPES = ["health"] as const;

export const INSURANCE_POLICY_FIELDS = [
  { key: "insurer", label: "Insurer", placeholder: "Acme Mutual" },
  { key: "planName", label: "Plan Name", placeholder: "Gold PPO" },
  { key: "policyNumber", label: "Policy Number" },
  { key: "memberId", label: "Member ID", variants: MEMBER_PLAN_TYPES },
  {
    key: "groupNumber",
    label: "Group Number",
    variants: MEMBER_PLAN_TYPES,
  },
  { key: "rxBin", label: "Rx BIN", variants: PRESCRIPTION_PLAN_TYPES },
  { key: "rxPcn", label: "Rx PCN", variants: PRESCRIPTION_PLAN_TYPES },
  { key: "rxGroup", label: "Rx Group", variants: PRESCRIPTION_PLAN_TYPES },
  { key: "policyholder", label: "Policyholder" },
  { key: "insured", label: "Insured Person or Property" },
  { key: "effectiveDate", label: "Effective Date", type: "date" },
  { key: "expirationDate", label: "Expiration Date", type: "date" },
  { key: "agentName", label: "Agent or Contact" },
  { key: "agentPhone", label: "Agent Phone", type: "tel" },
] as const satisfies ReadonlyArray<VariantDocumentFieldDefinition>;

type InsurancePolicyFieldDefinition = (typeof INSURANCE_POLICY_FIELDS)[number];
type InsurancePolicyFieldKey = InsurancePolicyFieldDefinition["key"];

export type InsurancePolicyDocumentFields = Record<
  InsurancePolicyFieldKey | "policyType",
  string
>;

const RX_BIN_PATTERN = /^\d{6}$/u;

const INSURED_LABEL_BY_POLICY_TYPE: Readonly<Record<string, string>> = {
  auto: "Insured Vehicle",
  dental: "Covered Members",
  health: "Covered Members",
  home: "Insured Property",
  life: "Insured Person",
  renters: "Insured Property",
  vision: "Covered Members",
};

/** The label a field takes for the document's policy type. */
export function getInsurancePolicyFieldLabel(
  field: InsurancePolicyFieldDefinition,
  policyType: string,
): string {
  return field.key === "insured"
    ? (INSURED_LABEL_BY_POLICY_TYPE[policyType.trim()] ?? field.label)
    : field.label;
}

function getInsurancePolicyTypeLabel(policyType: string): string {
  return getDocumentFieldOptionLabel(INSURANCE_POLICY_TYPE_OPTIONS, policyType);
}

export function readInsurancePolicyFields(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<InsurancePolicyDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  const read = (key: string) => readStringDocumentField(source, key, issues);
  const fields: InsurancePolicyDocumentFields = {
    policyType: read("policyType"),
    insurer: read("insurer"),
    planName: read("planName"),
    policyNumber: read("policyNumber"),
    memberId: read("memberId"),
    groupNumber: read("groupNumber"),
    rxBin: read("rxBin"),
    rxPcn: read("rxPcn"),
    rxGroup: read("rxGroup"),
    policyholder: read("policyholder"),
    insured: read("insured"),
    effectiveDate: read("effectiveDate"),
    expirationDate: read("expirationDate"),
    agentName: read("agentName"),
    agentPhone: read("agentPhone"),
  };

  addDateOnlyFormatIssue(issues, "effectiveDate", fields.effectiveDate);
  addDateOnlyFormatIssue(issues, "expirationDate", fields.expirationDate);
  const datesValid = !issues.some(
    (issue) =>
      issue.field === "effectiveDate" || issue.field === "expirationDate",
  );
  // Both dates are YYYY-MM-DD here, so string order is calendar order.
  if (
    datesValid &&
    fields.effectiveDate.length > 0 &&
    fields.expirationDate.length > 0 &&
    fields.expirationDate < fields.effectiveDate
  ) {
    addFormatIssue(
      issues,
      "expirationDate",
      fields.expirationDate,
      "Expected an expiration date on or after the effective date.",
    );
  }
  const rxBin = fields.rxBin.trim();
  if (rxBin.length > 0 && !RX_BIN_PATTERN.test(rxBin)) {
    addFormatIssue(issues, "rxBin", fields.rxBin, "Expected a 6-digit Rx BIN.");
  }

  return { fields, issues };
}

export function readInsurancePolicyFieldValues(
  source: Readonly<Record<string, unknown>>,
): InsurancePolicyDocumentFields {
  return readInsurancePolicyFields(source).fields;
}

const untitledTitle = "Untitled insurance policy";

// "Acme Mutual Health Insurance", degrading to whichever of insurer and type
// are set, then to the last four characters of the policy or member number
// (never a whole identifier: see identifierEnding), then to the untitled title.
function deriveInsurancePolicyTitle(
  fields: InsurancePolicyDocumentFields,
): string {
  const policyType = fields.policyType.trim();
  const typeLabel =
    policyType === "other" ? "" : getInsurancePolicyTypeLabel(policyType);
  const insurer = fields.insurer.trim();
  if (insurer.length > 0 || typeLabel.length > 0) {
    return [insurer, typeLabel, "Insurance"]
      .filter((part) => part.length > 0)
      .join(" ");
  }

  const ending = identifierEnding(fields.policyNumber, fields.memberId);
  return ending.length > 0
    ? `Insurance Policy ending ${ending}`
    : untitledTitle;
}

export const INSURANCE_POLICY_SLOTS: ReadonlyArray<DocumentAttachmentSlot> = [
  { label: "Card Front", slotId: "card-front" },
  { label: "Card Back", slotId: "card-back" },
  {
    accept: "image-or-pdf",
    itemLabel: "Policy Document",
    label: "Policy Documents",
    multiple: true,
    slotId: "policy-documents",
  },
];

export const insurancePolicyDocumentProjectorDefinition: AppDocumentProjectorDefinition =
  {
    createIcon: ShieldCheckIcon,
    createLabel: "Insurance Policy",
    kind: INSURANCE_POLICY_DOCUMENT_KIND,
    label: "insurance policy",
    project: structuredFieldsProjector(
      readInsurancePolicyFields,
      deriveInsurancePolicyTitle,
    ),
    untitledTitle,
  };
