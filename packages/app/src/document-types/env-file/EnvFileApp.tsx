import { ENV_FILE_DOCUMENT_KIND } from "@tearleads/client-sdk";
import { createDocumentTypeApp } from "../shared/createDocumentTypeApp";
import { EnvFile } from "./EnvFile";

export const EnvFileDocumentApp = createDocumentTypeApp(
  ENV_FILE_DOCUMENT_KIND,
  EnvFile,
);
