import {
  assertKnownKeys,
  isRecord,
  type JsonRecord,
  readArray,
  readBoolean,
  readOptionalString,
  readRecord,
  readString,
  readStringArray,
} from "./json";

/**
 * The parts of docs/openapi.json the API reference presents, read with
 * narrowing helpers. Any key outside the known set throws, so a generator
 * change that adds something the pages would silently drop fails the build.
 */

export type JsonSchema = boolean | JsonRecord;

export interface ApiParameter {
  readonly name: string;
  readonly location: "path" | "query" | "header";
  readonly required: boolean;
  readonly description: string | undefined;
  readonly schema: JsonSchema;
}

export interface ApiBody {
  readonly mediaType: string;
  readonly schema: JsonSchema;
}

export interface ApiHeader {
  readonly name: string;
  readonly required: boolean;
  readonly description: string | undefined;
  readonly schema: JsonSchema;
}

export interface ApiResponse {
  readonly status: string;
  /** The HTTP reason phrase the generator writes as the description. */
  readonly reason: string;
  readonly body: ApiBody | undefined;
  readonly headers: readonly ApiHeader[];
}

export interface ApiRefinement {
  readonly id: string;
  readonly description: string;
}

export interface ApiOperation {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly summary: string;
  readonly description: string | undefined;
  readonly tag: string;
  readonly requiresSession: boolean;
  readonly parameters: readonly ApiParameter[];
  readonly requestBody: ApiBody | undefined;
  readonly responses: readonly ApiResponse[];
  readonly refinements: readonly ApiRefinement[];
}

export interface ApiTag {
  readonly name: string;
  readonly description: string | undefined;
}

export interface ApiDocument {
  readonly title: string;
  readonly version: string;
  readonly description: string;
  readonly tags: readonly ApiTag[];
  readonly operations: readonly ApiOperation[];
  readonly schemas: ReadonlyMap<string, JsonSchema>;
}

const methods = new Set(["get", "put", "post", "delete", "patch"]);
const documentKeys = new Set([
  "openapi",
  "info",
  "jsonSchemaDialect",
  "paths",
  "components",
  "tags",
]);
const operationKeys = new Set([
  "operationId",
  "summary",
  "description",
  "tags",
  "parameters",
  "requestBody",
  "responses",
  "security",
  "x-tearleads-runtime-refinements",
]);
const parameterKeys = new Set([
  "name",
  "in",
  "required",
  "description",
  "schema",
  "style",
  "explode",
]);

function readSchema(value: unknown, where: string): JsonSchema {
  if (typeof value === "boolean" || isRecord(value)) return value;
  throw new Error(`${where}: expected a JSON Schema`);
}

/** A content map with at most one media type, as every operation has. */
function readContent(value: unknown, where: string): ApiBody | undefined {
  if (value === undefined) return undefined;
  const entries = Object.entries(readRecord(value, where));
  if (entries.length !== 1) {
    throw new Error(`${where}: expected exactly one media type`);
  }
  const [[mediaType, media]] = entries;
  const mediaRecord = readRecord(media, `${where}.${mediaType}`);
  assertKnownKeys(mediaRecord, new Set(["schema"]), `${where}.${mediaType}`);
  return {
    mediaType,
    schema: readSchema(mediaRecord.schema, `${where}.${mediaType}.schema`),
  };
}

function readParameter(value: unknown, where: string): ApiParameter {
  const parameter = readRecord(value, where);
  assertKnownKeys(parameter, parameterKeys, where);
  const location = readString(parameter.in, `${where}.in`);
  if (location !== "path" && location !== "query" && location !== "header") {
    throw new Error(`${where}.in: unsupported location ${location}`);
  }
  return {
    name: readString(parameter.name, `${where}.name`),
    location,
    required: readBoolean(parameter.required, `${where}.required`),
    description: readOptionalString(
      parameter.description,
      `${where}.description`,
    ),
    schema: readSchema(parameter.schema, `${where}.schema`),
  };
}

function readHeaders(value: unknown, where: string): readonly ApiHeader[] {
  if (value === undefined) return [];
  return Object.entries(readRecord(value, where)).map(([name, header]) => {
    const at = `${where}.${name}`;
    const record = readRecord(header, at);
    assertKnownKeys(record, new Set(["required", "description", "schema"]), at);
    return {
      name,
      required:
        record.required === undefined
          ? false
          : readBoolean(record.required, `${at}.required`),
      description: readOptionalString(record.description, `${at}.description`),
      schema: readSchema(record.schema, `${at}.schema`),
    };
  });
}

function readResponses(value: unknown, where: string): readonly ApiResponse[] {
  return Object.entries(readRecord(value, where)).map(([status, response]) => {
    const at = `${where}.${status}`;
    const record = readRecord(response, at);
    assertKnownKeys(record, new Set(["description", "content", "headers"]), at);
    return {
      status,
      reason: readString(record.description, `${at}.description`),
      body: readContent(record.content, `${at}.content`),
      headers: readHeaders(record.headers, `${at}.headers`),
    };
  });
}

function readRequestBody(value: unknown, where: string): ApiBody | undefined {
  if (value === undefined) return undefined;
  const record = readRecord(value, where);
  assertKnownKeys(record, new Set(["content", "required"]), where);
  if (record.required !== true) {
    throw new Error(`${where}: optional request bodies are not presented`);
  }
  return readContent(record.content, `${where}.content`);
}

/** True for a bearer session, false for a public operation. */
function readSecurity(value: unknown, where: string): boolean {
  const requirements = readArray(value, where);
  if (requirements.length === 0) return false;
  const [requirement] = requirements;
  if (
    requirements.length === 1 &&
    isRecord(requirement) &&
    Object.keys(requirement).join() === "bearerAuth"
  ) {
    return true;
  }
  throw new Error(`${where}: unsupported security requirement`);
}

function readRefinements(
  value: unknown,
  where: string,
): readonly ApiRefinement[] {
  if (value === undefined) return [];
  return readArray(value, where).map((item, index) => {
    const at = `${where}[${index}]`;
    const record = readRecord(item, at);
    assertKnownKeys(record, new Set(["id", "description"]), at);
    return {
      id: readString(record.id, `${at}.id`),
      description: readString(record.description, `${at}.description`),
    };
  });
}

function readOperation(
  method: string,
  path: string,
  value: unknown,
): ApiOperation {
  const where = `paths.${path}.${method}`;
  const operation = readRecord(value, where);
  assertKnownKeys(operation, operationKeys, where);
  const tags = readStringArray(operation.tags, `${where}.tags`);
  const [tag] = tags;
  if (tags.length !== 1 || tag === undefined) {
    throw new Error(`${where}.tags: expected exactly one tag`);
  }
  return {
    operationId: readString(operation.operationId, `${where}.operationId`),
    method,
    path,
    summary: readString(operation.summary, `${where}.summary`),
    description: readOptionalString(
      operation.description,
      `${where}.description`,
    ),
    tag,
    requiresSession: readSecurity(operation.security, `${where}.security`),
    parameters: readArray(
      operation.parameters ?? [],
      `${where}.parameters`,
    ).map((parameter, index) =>
      readParameter(parameter, `${where}.parameters[${index}]`),
    ),
    requestBody: readRequestBody(operation.requestBody, `${where}.requestBody`),
    responses: readResponses(operation.responses, `${where}.responses`),
    refinements: readRefinements(
      operation["x-tearleads-runtime-refinements"],
      `${where}.x-tearleads-runtime-refinements`,
    ),
  };
}

function readOperations(value: unknown): readonly ApiOperation[] {
  const operations: ApiOperation[] = [];
  for (const [path, item] of Object.entries(readRecord(value, "paths"))) {
    for (const [method, operation] of Object.entries(
      readRecord(item, `paths.${path}`),
    )) {
      if (!methods.has(method)) {
        throw new Error(`paths.${path}: unsupported key "${method}"`);
      }
      operations.push(readOperation(method, path, operation));
    }
  }
  return operations;
}

/** Declared tags first, in document order, then any others as first used. */
function readTags(
  value: unknown,
  operations: readonly ApiOperation[],
): readonly ApiTag[] {
  const tags = new Map<string, ApiTag>();
  for (const [index, item] of readArray(value ?? [], "tags").entries()) {
    const record = readRecord(item, `tags[${index}]`);
    assertKnownKeys(record, new Set(["name", "description"]), `tags[${index}]`);
    const name = readString(record.name, `tags[${index}].name`);
    tags.set(name, {
      name,
      description: readOptionalString(
        record.description,
        `tags[${index}].description`,
      ),
    });
  }
  for (const operation of operations) {
    if (!tags.has(operation.tag)) {
      tags.set(operation.tag, { name: operation.tag, description: undefined });
    }
  }
  return [...tags.values()];
}

function readSchemas(value: unknown): ReadonlyMap<string, JsonSchema> {
  const components = readRecord(value, "components");
  assertKnownKeys(
    components,
    new Set(["schemas", "securitySchemes"]),
    "components",
  );
  return new Map(
    Object.entries(readRecord(components.schemas, "components.schemas")).map(
      ([name, schema]) => [
        name,
        readSchema(schema, `components.schemas.${name}`),
      ],
    ),
  );
}

export function parseApiDocument(text: string): ApiDocument {
  const document = readRecord(JSON.parse(text), "document");
  assertKnownKeys(document, documentKeys, "document");
  const info = readRecord(document.info, "info");
  assertKnownKeys(info, new Set(["title", "version", "description"]), "info");
  const operations = readOperations(document.paths);
  return {
    title: readString(info.title, "info.title"),
    version: readString(info.version, "info.version"),
    description: readString(info.description, "info.description"),
    tags: readTags(document.tags, operations),
    operations,
    schemas: readSchemas(document.components),
  };
}
