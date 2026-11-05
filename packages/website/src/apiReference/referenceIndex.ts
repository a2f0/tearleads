import GithubSlugger from "github-slugger";
import type {
  ApiDocument,
  ApiOperation,
  ApiTag,
  JsonSchema,
} from "./openApiDocument";

/**
 * Site paths and cross-links of the API reference: one page per operation
 * (/docs/api/<slug>/), one per named schema (/docs/api/schemas/<Name>/),
 * operations grouped by tag, and which operations and schemas use a schema.
 */

export const referencePath = "/docs/api/";
export const downloadPath = "/openapi.json";

/** `containers.documentLanes.query` -> `containers-document-lanes-query`. */
export function operationSlug(operationId: string): string {
  return operationId
    .split(".")
    .map((segment) =>
      segment.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(),
    )
    .join("-");
}

export function operationPath(operation: ApiOperation): string {
  return `${referencePath}${operationSlug(operation.operationId)}/`;
}

export function schemaPath(name: string): string {
  return `${referencePath}schemas/${name}/`;
}

/** Slugs keyed by operationId; throws if two operations share one. */
export function operationSlugs(
  operations: readonly ApiOperation[],
): ReadonlyMap<string, string> {
  const owners = new Map<string, string>();
  for (const operation of operations) {
    const slug = operationSlug(operation.operationId);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug === "schemas") {
      throw new Error(`${operation.operationId}: unusable page slug ${slug}`);
    }
    const owner = owners.get(slug);
    if (owner !== undefined) {
      throw new Error(`${owner} and ${operation.operationId} share ${slug}`);
    }
    owners.set(slug, operation.operationId);
  }
  return new Map([...owners].map(([slug, id]) => [id, slug]));
}

export interface TagGroup {
  readonly tag: ApiTag;
  /** The group's heading anchor on the index page. */
  readonly anchor: string;
  readonly operations: readonly ApiOperation[];
}

/** Tags in document order, each with its operations in document order. */
export function tagGroups(document: ApiDocument): readonly TagGroup[] {
  const slugger = new GithubSlugger();
  return document.tags
    .map((tag) => ({
      tag,
      anchor: slugger.slug(tag.name),
      operations: document.operations.filter(
        (operation) => operation.tag === tag.name,
      ),
    }))
    .filter((group) => group.operations.length > 0);
}

export interface Neighbours {
  readonly previous: ApiOperation | undefined;
  readonly next: ApiOperation | undefined;
}

export function neighbours(
  document: ApiDocument,
  operation: ApiOperation,
): Neighbours {
  const siblings = document.operations.filter(
    (candidate) => candidate.tag === operation.tag,
  );
  const index = siblings.indexOf(operation);
  return { previous: siblings[index - 1], next: siblings[index + 1] };
}

/** Every component a JSON value names with `$ref`, at any depth. */
function referencedSchemas(value: unknown, into = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) referencedSchemas(item, into);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (key === "$ref" && typeof item === "string") {
        into.add(item.replace(/^#\/components\/schemas\//, ""));
      } else {
        referencedSchemas(item, into);
      }
    }
  }
  return into;
}

function operationSchemas(operation: ApiOperation): readonly JsonSchema[] {
  return [
    ...operation.parameters.map((parameter) => parameter.schema),
    ...(operation.requestBody === undefined
      ? []
      : [operation.requestBody.schema]),
    ...operation.responses.flatMap((response) => [
      ...(response.body === undefined ? [] : [response.body.schema]),
      ...response.headers.map((header) => header.schema),
    ]),
  ];
}

export interface SchemaUsage {
  readonly operations: readonly ApiOperation[];
  readonly schemas: readonly string[];
}

/** For each schema, the operations and schemas that reference it directly. */
export function schemaUsage(
  document: ApiDocument,
): ReadonlyMap<string, SchemaUsage> {
  const operations = new Map<string, ApiOperation[]>();
  const schemas = new Map<string, string[]>();
  const add = <T>(map: Map<string, T[]>, name: string, user: T) => {
    if (!document.schemas.has(name)) {
      throw new Error(`$ref to unknown schema ${name}`);
    }
    map.set(name, [...(map.get(name) ?? []), user]);
  };
  for (const operation of document.operations) {
    for (const name of referencedSchemas(operationSchemas(operation))) {
      add(operations, name, operation);
    }
  }
  for (const [user, schema] of document.schemas) {
    for (const name of referencedSchemas(schema)) {
      if (name !== user) add(schemas, name, user);
    }
  }
  return new Map(
    [...document.schemas.keys()].map((name) => [
      name,
      {
        operations: operations.get(name) ?? [],
        schemas: schemas.get(name) ?? [],
      },
    ]),
  );
}
