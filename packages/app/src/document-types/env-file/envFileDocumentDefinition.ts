import { FileCodeIcon } from "@phosphor-icons/react/dist/csr/FileCode";
import {
  type DocumentFieldValidationIssue,
  type DocumentRowSummary,
  readStringDocumentField,
} from "@symcrypt/client-sdk";
import type { AppDocumentProjectorDefinition } from "../types";

export const ENV_FILE_DOCUMENT_KIND = "env_file";
// The .env file name lives in a flat structured field (not the row list).
export const ENV_FILE_NAME_FIELD = "fileName";
// Row-field keys for a variable row in the document's first-class row list.
export const ENV_FILE_VARIABLE_KEY_FIELD = "key";
export const ENV_FILE_VARIABLE_VALUE_FIELD = "value";
const ENV_FILE_UNTITLED_TITLE = "Untitled .env file";

interface EnvFileVariableInput {
  key: string;
  value: string;
}

export const ENV_FILE_VARIABLE_NAME_PATTERN = "[A-Za-z_][A-Za-z0-9_]*";
const ENV_FILE_VARIABLE_NAME_REGEXP = new RegExp(
  `^${ENV_FILE_VARIABLE_NAME_PATTERN}$`,
  "u",
);

export function isValidEnvFileVariableName(value: string): boolean {
  return ENV_FILE_VARIABLE_NAME_REGEXP.test(value);
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  const first = trimmed[0];
  const last = trimmed.at(-1);
  return (first === '"' && last === '"') || (first === "'" && last === "'")
    ? trimmed.slice(1, -1)
    : trimmed;
}

// Parse .env text into ordered variable rows, dropping comments and any line
// whose key is not a POSIX variable name.
export function parseEnvFileText(text: string): EnvFileVariableInput[] {
  return text.split(/\r?\n/u).flatMap((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      return [];
    }

    const assignment = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trimStart()
      : trimmed;
    const equalsIndex = assignment.indexOf("=");
    if (equalsIndex < 0) {
      return [];
    }

    const key = assignment.slice(0, equalsIndex).trim();
    if (key.length === 0 || !isValidEnvFileVariableName(key)) {
      return [];
    }

    return [{ key, value: unquoteEnvValue(assignment.slice(equalsIndex + 1)) }];
  });
}

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
