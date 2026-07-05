import {
  ENV_FILE_VARIABLE_NAME_PATTERN,
  type EnvFileDocumentFields,
  type EnvFileVariable,
  isValidEnvFileVariableName,
  readEnvFileFieldsFromRecord,
  serializeEnvFileVariables,
} from "./envFileDocumentDefinition";

export type { EnvFileDocumentFields, EnvFileVariable };
export {
  ENV_FILE_VARIABLE_NAME_PATTERN,
  isValidEnvFileVariableName,
  serializeEnvFileVariables,
};

export function readEnvFileFields(
  fields: Readonly<Record<string, unknown>>,
): EnvFileDocumentFields {
  return readEnvFileFieldsFromRecord(fields).fields;
}
