import { createDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { EnvFile } from "./EnvFile";
import { ENV_FILE_DOCUMENT_KIND } from "./envFileDocumentDefinition";

export const EnvFileDocumentApp = createDocumentTypeApp(
  ENV_FILE_DOCUMENT_KIND,
  EnvFile,
);
