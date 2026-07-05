import { FileCodeIcon } from "@phosphor-icons/react/dist/csr/FileCode";
import {
  type DocumentFieldValidationIssue,
  readStringDocumentField,
  type ValidatedDocumentFields,
} from "@tearleads/client-sdk";
import type { AppDocumentProjectorDefinition } from "../types";

export const ENV_FILE_DOCUMENT_KIND = "env_file";
export const ENV_FILE_VARIABLES_FIELD = "variablesJson";
const ENV_FILE_UNTITLED_TITLE = "Untitled .env file";

export interface EnvFileVariable {
  id: string;
  key: string;
  value: string;
}

export interface EnvFileDocumentFields {
  fileName: string;
  variables: ReadonlyArray<EnvFileVariable>;
  variablesJson: string;
}

export const ENV_FILE_VARIABLE_NAME_PATTERN = "[A-Za-z_][A-Za-z0-9_]*";
const ENV_FILE_VARIABLE_NAME_REGEXP = new RegExp(
  `^${ENV_FILE_VARIABLE_NAME_PATTERN}$`,
  "u",
);

export function isValidEnvFileVariableName(value: string): boolean {
  return ENV_FILE_VARIABLE_NAME_REGEXP.test(value);
}

function createImportedVariableId(index: number, key: string): string {
  const normalizedKey = key
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
  return `env-${index + 1}-${normalizedKey || "variable"}`;
}

function readStringProperty(
  source: object,
  property: string,
  issues: DocumentFieldValidationIssue[],
  field: string,
): string {
  const value: unknown = Reflect.get(source, property);
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }

  issues.push({
    field,
    message: "Expected a string value.",
    value,
  });
  return "";
}

function readEnvFileVariablesJson(
  variablesJson: string,
  issues: DocumentFieldValidationIssue[],
): EnvFileVariable[] {
  if (variablesJson.trim().length === 0) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(variablesJson);
  } catch {
    issues.push({
      field: ENV_FILE_VARIABLES_FIELD,
      message: "Expected a JSON array of environment variable entries.",
      value: variablesJson,
    });
    return [];
  }

  if (!Array.isArray(parsed)) {
    issues.push({
      field: ENV_FILE_VARIABLES_FIELD,
      message: "Expected a JSON array of environment variable entries.",
      value: parsed,
    });
    return [];
  }

  return parsed.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push({
        field: `${ENV_FILE_VARIABLES_FIELD}[${index}]`,
        message: "Expected an environment variable entry object.",
        value: entry,
      });
      return [];
    }

    const key = readStringProperty(
      entry,
      "key",
      issues,
      `${ENV_FILE_VARIABLES_FIELD}[${index}].key`,
    );
    const value = readStringProperty(
      entry,
      "value",
      issues,
      `${ENV_FILE_VARIABLES_FIELD}[${index}].value`,
    );
    const rawId = readStringProperty(
      entry,
      "id",
      issues,
      `${ENV_FILE_VARIABLES_FIELD}[${index}].id`,
    );
    const id = rawId.trim() || createImportedVariableId(index, key);

    if (key.length > 0 && !isValidEnvFileVariableName(key)) {
      issues.push({
        field: `${ENV_FILE_VARIABLES_FIELD}[${index}].key`,
        message: "Expected an environment variable key like API_TOKEN.",
        value: key,
      });
    }

    return [{ id, key, value }];
  });
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

export function parseEnvFileText(text: string): EnvFileVariable[] {
  return text.split(/\r?\n/u).flatMap((line, index) => {
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

    return [
      {
        id: createImportedVariableId(index, key),
        key,
        value: unquoteEnvValue(assignment.slice(equalsIndex + 1)),
      },
    ];
  });
}

export function serializeEnvFileVariables(
  variables: ReadonlyArray<EnvFileVariable>,
): string {
  return JSON.stringify(
    variables.map((variable) => ({
      id: variable.id,
      key: variable.key,
      value: variable.value,
    })),
  );
}

function deriveEnvFileTitle(fields: EnvFileDocumentFields): string {
  const fileName = fields.fileName.trim();
  if (fileName.length > 0) {
    return fileName;
  }

  const variableCount = fields.variables.filter(
    (variable) => variable.key.trim().length > 0,
  ).length;
  if (variableCount > 0) {
    return `.env (${variableCount} variable${variableCount === 1 ? "" : "s"})`;
  }

  return ENV_FILE_UNTITLED_TITLE;
}

export function readEnvFileFieldsFromRecord(
  source: Readonly<Record<string, unknown>>,
): ValidatedDocumentFields<EnvFileDocumentFields> {
  const issues: DocumentFieldValidationIssue[] = [];
  const variablesJson = readStringDocumentField(
    source,
    ENV_FILE_VARIABLES_FIELD,
    issues,
  );
  const variables = readEnvFileVariablesJson(variablesJson, issues);

  return {
    fields: {
      fileName: readStringDocumentField(source, "fileName", issues),
      variables,
      variablesJson: serializeEnvFileVariables(variables),
    },
    issues,
  };
}

export const envFileDocumentProjectorDefinition: AppDocumentProjectorDefinition =
  {
    createIcon: FileCodeIcon,
    createLabel: ".env File",
    kind: ENV_FILE_DOCUMENT_KIND,
    label: ".env file",
    project: ({ structuredFields }) => {
      const validated = readEnvFileFieldsFromRecord(structuredFields);
      return {
        fieldValidationIssues: validated.issues,
        structuredFields: {
          fileName: validated.fields.fileName,
          [ENV_FILE_VARIABLES_FIELD]: validated.fields.variablesJson,
        },
        title: deriveEnvFileTitle(validated.fields),
      };
    },
    untitledTitle: ENV_FILE_UNTITLED_TITLE,
  };
