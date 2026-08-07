import { createDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { Weight } from "./Weight";
import { WEIGHT_DOCUMENT_KIND } from "./weightDocumentDefinition";

export const WeightDocumentApp = createDocumentTypeApp(
  WEIGHT_DOCUMENT_KIND,
  Weight,
);
