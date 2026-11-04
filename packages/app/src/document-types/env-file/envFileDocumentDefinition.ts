import { FileCodeIcon } from "@phosphor-icons/react/dist/csr/FileCode";
import type { ENV_FILE_DOCUMENT_KIND as SDK_ENV_FILE_DOCUMENT_KIND } from "@tearleads/client-sdk";
import {
  type DocumentFieldValidationIssue,
  type DocumentRowSummary,
  ENV_FILE_NAME_FIELD,
  ENV_FILE_VARIABLE_KEY_FIELD,
  isValidEnvFileVariableName,
  readStringDocumentField,
} from "@tearleads/client-sdk";
import type { AppDocumentProjectorDefinition } from "../types";

// Module-scope code must not read SDK values: in the Bun dev bundle the SDK
// root finishes evaluating only after its async Loro WASM dependency, so app
// modules evaluated first see its namespace as null. The type ties this
// module-scope copy to the SDK's kind; function bodies read the SDK directly.
export const ENV_FILE_DOCUMENT_KIND: typeof SDK_ENV_FILE_DOCUMENT_KIND =
  "env_file";

const ENV_FILE_UNTITLED_TITLE = "Untitled .env file";

function deriveEnvFileTitle(fileName: string): string {
  const trimmedFileName = fileName.trim();
  if (trimmedFileName.length > 0) {
    return trimmedFileName;
  }

  return ENV_FILE_UNTITLED_TITLE;
}

function validateEnvFileRows(
  rows: ReadonlyArray<DocumentRowSummary> | undefined,
  issues: DocumentFieldValidationIssue[],
): void {
  (rows ?? []).forEach((row, index) => {
    const key = row.fields[ENV_FILE_VARIABLE_KEY_FIELD] ?? "";
    if (key.length > 0 && !isValidEnvFileVariableName(key)) {
      issues.push({
        field: `rows[${index}].key`,
        message: "Expected an environment variable key like API_TOKEN.",
        value: key,
      });
    }
  });
}

export const envFileDocumentProjectorDefinition: AppDocumentProjectorDefinition =
  {
    createIcon: FileCodeIcon,
    createLabel: ".env File",
    kind: ENV_FILE_DOCUMENT_KIND,
    label: ".env file",
    project: ({ rows, structuredFields }) => {
      const issues: DocumentFieldValidationIssue[] = [];
      const fileName = readStringDocumentField(
        structuredFields,
        ENV_FILE_NAME_FIELD,
        issues,
      );
      validateEnvFileRows(rows, issues);
      return {
        fieldValidationIssues: issues,
        structuredFields: { fileName },
        title: deriveEnvFileTitle(fileName),
      };
    },
    untitledTitle: ENV_FILE_UNTITLED_TITLE,
  };
