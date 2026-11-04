import type { z } from "zod";
import { JSON_SCHEMA_COMPONENT_KEY } from "../jsonSchema";
import * as realtimeSchemas from "../realtime";
import * as requestSchemas from "../request";
import * as responseSchemas from "../response";
import * as errorResponseSchemas from "../response/error";
import * as preparationResponseSchemas from "../response/principalHistoryPreparation";
import * as utilSchemas from "../util";

const SCHEMA_EXPORT_SUFFIX = "Schema";
const COMPONENT_REFERENCE_PREFIX = "#/components/schemas/";

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isZodSchema(value: unknown): value is z.core.$ZodType {
  return (
    typeof value === "object" &&
    value !== null &&
    "_zod" in value &&
    typeof value._zod === "object" &&
    value._zod !== null &&
    "def" in value._zod
  );
}

/**
 * Names every exported wire schema after its export (`ContainerSchema` becomes
 * `Container`) so the published OpenAPI document can define it once under
 * components and reference it by name. A schema exported under several names
 * (an alias such as ChallengeErrorResponseSchema) takes the shortest, then the
 * first in code-unit order.
 */
export function collectOpenApiComponentNames(): ReadonlyMap<
  z.core.$ZodType,
  string
> {
  // The barrels plus the shared response envelopes they do not re-export.
  const exports = [
    errorResponseSchemas,
    preparationResponseSchemas,
    realtimeSchemas,
    requestSchemas,
    responseSchemas,
    utilSchemas,
  ].flatMap((module) => Object.entries(module));
  const byName = new Map<string, z.core.$ZodType>();
  for (const [exportName, value] of exports) {
    if (
      !exportName.endsWith(SCHEMA_EXPORT_SUFFIX) ||
      exportName === SCHEMA_EXPORT_SUFFIX ||
      !isZodSchema(value)
    ) {
      continue;
    }
    const name = exportName.slice(0, -SCHEMA_EXPORT_SUFFIX.length);
    const existing = byName.get(name);
    if (existing !== undefined && existing !== value) {
      throw new Error(`OpenAPI component name ${name} names two schemas`);
    }
    byName.set(name, value);
  }

  const names = new Map<z.core.$ZodType, string>();
  const sortedNames = [...byName.keys()].sort((left, right) =>
    left.length !== right.length
      ? left.length - right.length
      : compareCodeUnits(left, right),
  );
  for (const name of sortedNames) {
    const schema = byName.get(name);
    if (schema !== undefined && !names.has(schema)) {
      names.set(schema, name);
    }
  }
  return names;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Composite schemas become components; scalars stay inline where used. */
function isComponentShape(schema: Record<string, unknown>): boolean {
  const { type } = schema;
  return (
    type === "object" ||
    type === "array" ||
    "anyOf" in schema ||
    "oneOf" in schema ||
    "allOf" in schema
  );
}

interface ExtractedComponent {
  readonly canonical: string;
  readonly schema: Record<string, unknown>;
}

function extractComponents(
  value: unknown,
  components: Map<string, ExtractedComponent>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => extractComponents(item, components));
  }
  if (!isRecord(value)) {
    return value;
  }

  const { [JSON_SCHEMA_COMPONENT_KEY]: name, ...rest } = value;
  const extracted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(rest)) {
    extracted[key] = extractComponents(child, components);
  }
  if (typeof name !== "string" || !isComponentShape(extracted)) {
    return extracted;
  }

  const canonical = canonicalJson(extracted);
  const existing = components.get(name);
  if (existing !== undefined && existing.canonical !== canonical) {
    throw new Error(`OpenAPI component ${name} projects inconsistently`);
  }
  components.set(name, { canonical, schema: extracted });
  return { $ref: `${COMPONENT_REFERENCE_PREFIX}${name}` };
}

/**
 * Moves every named schema out of `paths` into `components.schemas` and
 * replaces each use with a `$ref`. Resolving the references gives back the
 * inline document, which tests compare against the unnamed projection.
 */
export function referenceOpenApiComponents<
  Document extends { readonly components: object; readonly paths: object },
>(
  document: Document,
): Document & {
  readonly components: { readonly schemas: Record<string, object> };
} {
  const components = new Map<string, ExtractedComponent>();
  const paths = extractComponents(document.paths, components);
  const sortedNames = [...components.keys()].sort(compareCodeUnits);
  const schemas: Record<string, object> = {};
  for (const name of sortedNames) {
    const component = components.get(name);
    if (component !== undefined) {
      schemas[name] = component.schema;
    }
  }
  return {
    ...document,
    components: { ...document.components, schemas },
    paths: isRecord(paths) ? paths : {},
  };
}

/** Inlines every local component reference; the inverse of the above. */
export function resolveOpenApiComponents(
  value: unknown,
  schemas: Readonly<Record<string, unknown>>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveOpenApiComponents(item, schemas));
  }
  if (!isRecord(value)) {
    return value;
  }
  const { $ref: reference } = value;
  if (
    typeof reference === "string" &&
    reference.startsWith(COMPONENT_REFERENCE_PREFIX)
  ) {
    const schema = schemas[reference.slice(COMPONENT_REFERENCE_PREFIX.length)];
    if (schema === undefined) {
      throw new Error(`Unknown OpenAPI component reference ${reference}`);
    }
    return resolveOpenApiComponents(schema, schemas);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      resolveOpenApiComponents(child, schemas),
    ]),
  );
}
