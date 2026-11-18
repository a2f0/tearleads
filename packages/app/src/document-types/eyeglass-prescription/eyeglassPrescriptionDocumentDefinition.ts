import { EyeglassesIcon } from "@phosphor-icons/react/dist/csr/Eyeglasses";
import {
  type DocumentFieldValidationIssue,
  readStringDocumentField,
  type StoredDocumentKind,
} from "@tearleads/client-sdk";
import {
  addDateOnlyFormatIssue,
  structuredFieldsProjector,
} from "../shared/documentFieldUtils";
import type { AppDocumentProjectorDefinition } from "../types";

export const EYEGLASS_PRESCRIPTION_DOCUMENT_KIND =
  "eyeglass_prescription" satisfies StoredDocumentKind;

export const PRESCRIPTION_FIELDS = [
  { key: "patientName", label: "Patient Name", type: "text" },
  { key: "prescriber", label: "Prescriber", type: "text" },
  { key: "dateIssued", label: "Date Issued", type: "date" },
  { key: "expirationDate", label: "Expiration Date", type: "date" },
  { key: "rightSphere", label: "Right (OD) Sphere", type: "text" },
  { key: "rightCylinder", label: "Right (OD) Cylinder", type: "text" },
  { key: "rightAxis", label: "Right (OD) Axis", type: "text" },
  { key: "rightAdd", label: "Right (OD) Add", type: "text" },
  { key: "rightPrism", label: "Right (OD) Prism and Base", type: "text" },
  { key: "leftSphere", label: "Left (OS) Sphere", type: "text" },
  { key: "leftCylinder", label: "Left (OS) Cylinder", type: "text" },
  { key: "leftAxis", label: "Left (OS) Axis", type: "text" },
  { key: "leftAdd", label: "Left (OS) Add", type: "text" },
  { key: "leftPrism", label: "Left (OS) Prism and Base", type: "text" },
  { key: "pupillaryDistance", label: "Pupillary Distance (mm)", type: "text" },
] as const;

export function readPrescriptionFields(
  source: Readonly<Record<string, unknown>>,
) {
  const issues: DocumentFieldValidationIssue[] = [];
  const fields: Record<string, string> = {};
  for (const { key, type } of PRESCRIPTION_FIELDS) {
    const value = readStringDocumentField(source, key, issues);
    fields[key] = value;
    if (type === "date") addDateOnlyFormatIssue(issues, key, value);
  }
  return { fields, issues };
}

const untitledTitle = "Untitled eyeglass prescription";

export const eyeglassPrescriptionDocumentProjectorDefinition: AppDocumentProjectorDefinition =
  {
    createIcon: EyeglassesIcon,
    createLabel: "Eyeglass Prescription",
    kind: EYEGLASS_PRESCRIPTION_DOCUMENT_KIND,
    label: "eyeglass prescription",
    project: structuredFieldsProjector(
      readPrescriptionFields,
      ({ patientName, dateIssued }) => {
        const detail = [patientName?.trim(), dateIssued?.trim()]
          .filter(Boolean)
          .join(" · ");
        return detail ? `Eyeglass Prescription ${detail}` : untitledTitle;
      },
    ),
    untitledTitle,
  };
