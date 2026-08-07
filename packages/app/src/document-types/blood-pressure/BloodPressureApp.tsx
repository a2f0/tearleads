import { createDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { BloodPressure } from "./BloodPressure";
import { BLOOD_PRESSURE_DOCUMENT_KIND } from "./bloodPressureDocumentDefinition";

export const BloodPressureDocumentApp = createDocumentTypeApp(
  BLOOD_PRESSURE_DOCUMENT_KIND,
  BloodPressure,
);
