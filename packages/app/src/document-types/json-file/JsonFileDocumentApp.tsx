import { createDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { JsonFileDocument } from "./JsonFileDocument";
import { JSON_FILE_DOCUMENT_KIND } from "./jsonFileDocumentDefinition";

export const JsonFileDocumentApp = createDocumentTypeApp(
  JSON_FILE_DOCUMENT_KIND,
  JsonFileDocument,
);
