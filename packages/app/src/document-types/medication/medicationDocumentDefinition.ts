import { PillIcon } from "@phosphor-icons/react/dist/csr/Pill";
import {
  type DocumentFieldValidationIssue,
  type DocumentProjection,
  type DocumentProjectorInput,
  readStringDocumentField,
  type StoredDocumentKind,
  type ValidatedDocumentFields,
} from "@tearleads/client-sdk";
import type { DocumentAttachmentSlot } from "../shared/documentAttachmentUtils";
import {
  addDateOnlyFormatIssue,
  addFormatIssue,
  isValidDateOnly,
  structuredFieldsProjector,
} from "../shared/documentFieldUtils";
import { addRowLogIssues } from "../shared/rowLogModel";
import type { AppDocumentProjectorDefinition } from "../types";
import { MEDICATION_INTAKE_LOG } from "./medicationIntakeLog";

export const MEDICATION_DOCUMENT_KIND =
  "medication" satisfies StoredDocumentKind;

// What was prescribed. Doses actually taken are the intake log's rows, so the
// directions stay the prescriber's words however the log is kept.
export const MEDICATION_FIELDS = [
  { key: "medicationName", label: "Medication", placeholder: "Lisinopril" },
  { key: "strength", label: "Strength", placeholder: "10 mg" },
  { key: "dosageForm", label: "Form", placeholder: "Tablet" },
  {
    key: "directions",
    label: "Directions",
    placeholder: "Take 1 tablet by mouth once daily",
  },
  { key: "patientName", label: "Patient" },
  { key: "prescriber", label: "Prescriber" },
  { key: "pharmacy", label: "Pharmacy" },
  { key: "prescriptionNumber", label: "Rx Number" },
  { key: "startDate", label: "Start Date", type: "date" },
  { key: "endDate", label: "End Date", type: "date" },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  placeholder?: string;
  type?: "date";
}>;

type MedicationFieldKey = (typeof MEDICATION_FIELDS)[number]["key"];
export type MedicationDocumentFields = Record<MedicationFieldKey, string>;

function readMedicationFields(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<MedicationDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  const read = (key: string) => readStringDocumentField(source, key, issues);
  const fields: MedicationDocumentFields = {
    medicationName: read("medicationName"),
    strength: read("strength"),
    dosageForm: read("dosageForm"),
    directions: read("directions"),
    patientName: read("patientName"),
    prescriber: read("prescriber"),
    pharmacy: read("pharmacy"),
    prescriptionNumber: read("prescriptionNumber"),
    startDate: read("startDate"),
    endDate: read("endDate"),
  };

  addDateOnlyFormatIssue(issues, "startDate", fields.startDate);
  addDateOnlyFormatIssue(issues, "endDate", fields.endDate);
  const start = fields.startDate.trim();
  const end = fields.endDate.trim();
  if (isValidDateOnly(start) && isValidDateOnly(end) && end < start) {
    addFormatIssue(
      issues,
      "endDate",
      fields.endDate,
      "Expected an end date on or after the start date.",
    );
  }

  return { fields, issues };
}

export function readMedicationFieldValues(
  source: Readonly<Record<string, unknown>>,
): MedicationDocumentFields {
  return readMedicationFields(source).fields;
}

const untitledTitle = "Untitled medication";

// "Lisinopril 10 mg": the name with its strength, which together tell two
// prescriptions of one drug apart.
function deriveMedicationTitle(fields: MedicationDocumentFields): string {
  const name = fields.medicationName.trim();
  if (name.length === 0) {
    return untitledTitle;
  }
  const strength = fields.strength.trim();
  return strength.length > 0 ? `${name} ${strength}` : name;
}

export const MEDICATION_SLOTS: ReadonlyArray<DocumentAttachmentSlot> = [
  { label: "Label", slotId: "label" },
  { accept: "image-or-pdf", label: "Prescription", slotId: "prescription" },
];

const projectMedicationFields = structuredFieldsProjector(
  readMedicationFields,
  deriveMedicationTitle,
);

function projectMedication(input: DocumentProjectorInput): DocumentProjection {
  const projection = projectMedicationFields(input);
  const issues = [...projection.fieldValidationIssues];
  addRowLogIssues(input.rows, MEDICATION_INTAKE_LOG.fields, issues);
  return { ...projection, fieldValidationIssues: issues };
}

export const medicationDocumentProjectorDefinition = {
  createIcon: PillIcon,
  createLabel: "Medication",
  kind: MEDICATION_DOCUMENT_KIND,
  label: "medication",
  project: projectMedication,
  untitledTitle,
} satisfies AppDocumentProjectorDefinition;
