import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildProductionTokenIndex, isReferencedOutside } from "./fileWalk";

const httpMethods = new Set(["get", "post", "put", "patch", "delete"]);

export interface UnreadResponseFieldLead {
  readonly field: string;
  readonly routes: readonly string[];
}

export interface OpenApiInventory {
  readonly pathCount: number;
  readonly operationCount: number;
  readonly byMethod: Readonly<Record<string, number>>;
  readonly distinctResponseFields: number;
  readonly unreadResponseFields: readonly UnreadResponseFieldLead[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveSchemaRef(
  ref: string,
  schemas: Readonly<Record<string, unknown>>,
): unknown {
  const prefix = "#/components/schemas/";
  if (!ref.startsWith(prefix)) return undefined;
  return Reflect.get(schemas, ref.slice(prefix.length));
}

function collectResponseProperties(
  node: unknown,
  schemas: Readonly<Record<string, unknown>>,
  visited: Set<string>,
  properties: Set<string>,
  depth = 0,
): void {
  if (!isRecord(node) || depth > 4) return;
  const ref = Reflect.get(node, "$ref");
  if (typeof ref === "string") {
    if (visited.has(ref)) return;
    visited.add(ref);
    collectResponseProperties(
      resolveSchemaRef(ref, schemas),
      schemas,
      visited,
      properties,
      depth,
    );
    return;
  }

  const directProps = Reflect.get(node, "properties");
  if (isRecord(directProps)) {
    for (const [key, propSchema] of Object.entries(directProps)) {
      properties.add(key);
      collectResponseProperties(
        propSchema,
        schemas,
        visited,
        properties,
        depth + 1,
      );
    }
  }

  const items = Reflect.get(node, "items");
  if (items !== undefined) {
    collectResponseProperties(items, schemas, visited, properties, depth + 1);
  }

  for (const compositeKey of ["allOf", "oneOf", "anyOf"] as const) {
    const branchList = Reflect.get(node, compositeKey);
    if (!Array.isArray(branchList)) continue;
    for (const branch of branchList) {
      collectResponseProperties(
        branch,
        schemas,
        visited,
        properties,
        depth + 1,
      );
    }
  }
}

function extractOperation2xxFields(
  operation: Record<string, unknown>,
  schemas: Readonly<Record<string, unknown>>,
): Set<string> {
  const fields = new Set<string>();
  const responses = Reflect.get(operation, "responses");
  if (!isRecord(responses)) return fields;
  for (const [status, response] of Object.entries(responses)) {
    if (!status.startsWith("2") || !isRecord(response)) continue;
    const content = Reflect.get(response, "content");
    if (!isRecord(content)) continue;
    const appJson = Reflect.get(content, "application/json");
    if (!isRecord(appJson)) continue;
    const schema = Reflect.get(appJson, "schema");
    collectResponseProperties(schema, schemas, new Set(), fields);
  }
  return fields;
}

function recordRouteFields(
  route: string,
  operation: Record<string, unknown>,
  schemas: Readonly<Record<string, unknown>>,
  fieldToRoutes: Map<string, Set<string>>,
): void {
  for (const field of extractOperation2xxFields(operation, schemas)) {
    let routes = fieldToRoutes.get(field);
    if (!routes) {
      routes = new Set();
      fieldToRoutes.set(field, routes);
    }
    routes.add(route);
  }
}

export function extractOpenApiOperations(document: unknown): {
  readonly pathCount: number;
  readonly operationCount: number;
  readonly byMethod: Record<string, number>;
  readonly fieldToRoutes: Map<string, Set<string>>;
} {
  const byMethod: Record<string, number> = {};
  const fieldToRoutes = new Map<string, Set<string>>();
  if (!isRecord(document)) {
    return { pathCount: 0, operationCount: 0, byMethod, fieldToRoutes };
  }
  const components = Reflect.get(document, "components");
  const rawSchemas = isRecord(components)
    ? Reflect.get(components, "schemas")
    : undefined;
  const schemas = isRecord(rawSchemas) ? rawSchemas : {};
  const paths = Reflect.get(document, "paths");
  if (!isRecord(paths)) {
    return { pathCount: 0, operationCount: 0, byMethod, fieldToRoutes };
  }

  let operationCount = 0;
  const pathEntries = Object.entries(paths);
  for (const [pathKey, pathItem] of pathEntries) {
    if (!isRecord(pathItem)) continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!httpMethods.has(method) || !isRecord(operation)) continue;
      const upper = method.toUpperCase();
      operationCount += 1;
      byMethod[upper] = (byMethod[upper] ?? 0) + 1;
      recordRouteFields(
        `${upper} ${pathKey}`,
        operation,
        schemas,
        fieldToRoutes,
      );
    }
  }
  return {
    pathCount: pathEntries.length,
    operationCount,
    byMethod,
    fieldToRoutes,
  };
}

export async function auditOpenApi(
  repoRoot: string,
): Promise<OpenApiInventory> {
  const openApiPath = join(repoRoot, "docs/openapi.json");
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(await readFile(openApiPath, "utf8"));
  } catch {
    return {
      pathCount: 0,
      operationCount: 0,
      byMethod: {},
      distinctResponseFields: 0,
      unreadResponseFields: [],
    };
  }

  const { pathCount, operationCount, byMethod, fieldToRoutes } =
    extractOpenApiOperations(parsed);
  const consumerTokens = await buildProductionTokenIndex(repoRoot, [
    join(repoRoot, "packages/client-sdk/src"),
    join(repoRoot, "packages/api-client/src"),
    join(repoRoot, "packages/app/src"),
    join(repoRoot, "packages/cli/src"),
    join(repoRoot, "packages/crypto/src"),
    join(repoRoot, "packages/validators/src/response/writerProjectionWire.ts"),
    join(
      repoRoot,
      "packages/validators/src/response/manifestBundleReferences.ts",
    ),
  ]);

  const unreadResponseFields: UnreadResponseFieldLead[] = [];
  for (const [field, routes] of [...fieldToRoutes.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (!isReferencedOutside(consumerTokens, [field])) {
      unreadResponseFields.push({
        field,
        routes: [...routes].sort(),
      });
    }
  }

  return {
    pathCount,
    operationCount,
    byMethod,
    distinctResponseFields: fieldToRoutes.size,
    unreadResponseFields,
  };
}
