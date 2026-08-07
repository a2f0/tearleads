import { createFileDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { GENERIC_FILE_DOCUMENT_KIND } from "./genericFileDocumentDefinition";

export const GenericFileDocumentApp = createFileDocumentTypeApp(
  GENERIC_FILE_DOCUMENT_KIND,
  { title: "File" },
);
