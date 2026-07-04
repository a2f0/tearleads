import {
  type EnvFileDocumentFields,
  type EnvFileVariable,
  readEnvFileFieldsFromRecord,
  serializeEnvFileVariables,
} from "./envFileDocumentDefinition";

export type { EnvFileDocumentFields, EnvFileVariable };
export { serializeEnvFileVariables };

export function readEnvFileFields(
  fields: Readonly<Record<string, unknown>>,
): EnvFileDocumentFields {
  return readEnvFileFieldsFromRecord(fields).fields;
}
