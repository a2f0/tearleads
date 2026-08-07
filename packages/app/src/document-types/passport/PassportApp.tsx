import { createDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { Passport } from "./Passport";
import { PASSPORT_DOCUMENT_KIND } from "./passportDocumentDefinition";

export const PassportDocumentApp = createDocumentTypeApp(
  PASSPORT_DOCUMENT_KIND,
  Passport,
);
