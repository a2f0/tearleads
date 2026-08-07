import { z } from "zod";

interface JsonSchemaView {
  readonly key: string;
}

interface RuntimeRefinementProjection {
  readonly runtimeRefinementIds?: readonly string[];
}

interface RuntimeRefinementReference {
  readonly id: string;
}

type JsonSchemaProjection = (
  | {
      readonly kind: "fragment";
      readonly schema: z.core.JSONSchema.BaseSchema;
    }
  | {
      readonly kind: "zod";
      readonly schema: z.core.$ZodType;
    }
) &
  RuntimeRefinementProjection;

const jsonSchemaViewRegistry = z.registry<JsonSchemaView>();
const jsonSchemaViews = new Map<string, JsonSchemaProjection>();
const supportedJsonWireSchemaTypes = new Set([
  "array",
  "boolean",
  "custom",
  "literal",
  "never",
  "null",
  "nullable",
  "number",
  "object",
  "optional",
  "record",
  "string",
  "unknown",
  "union",
]);
const forbiddenJsonWireSchemaTypes = new Set([
  "catch",
  "default",
  "file",
  "lazy",
  "pipe",
  "prefault",
  "promise",
  "readonly",
  "success",
  "transform",
]);
const nativeMinLengthWhen = Reflect.get(z.minLength(0)._zod.def, "when");
const nativeMinLengthWhenSource =
  typeof nativeMinLengthWhen === "function"
    ? Function.prototype.toString.call(nativeMinLengthWhen)
    : undefined;
let nextJsonSchemaViewId = 0;

function registerProjection<RuntimeSchema extends z.ZodType>(
  runtimeSchema: RuntimeSchema,
  projection: JsonSchemaProjection,
): RuntimeSchema;
function registerProjection(
  runtimeSchema: z.ZodType,
  projection: JsonSchemaProjection,
): z.ZodType {
  const key = String(nextJsonSchemaViewId);
  nextJsonSchemaViewId += 1;
  jsonSchemaViews.set(key, projection);
  jsonSchemaViewRegistry.add(runtimeSchema, { key });
  return runtimeSchema;
}

/**
 * Associates an identity-preserving runtime schema with a structurally
 * equivalent schema that Zod can project to JSON Schema. Zod carries custom
 * registry entries across schema clones, but projection rejects inherited
 * views until the clone is registered explicitly.
 */
export function registerJsonSchemaView<RuntimeSchema extends z.ZodType>(
  runtimeSchema: RuntimeSchema,
  viewSchema: z.core.$ZodType,
): RuntimeSchema {
  return registerProjection(runtimeSchema, {
    kind: "zod",
    schema: viewSchema,
  });
}

export function registerJsonSchemaFragment<RuntimeSchema extends z.ZodType>(
  runtimeSchema: RuntimeSchema,
  jsonSchema: z.core.JSONSchema.BaseSchema,
): RuntimeSchema {
  return registerProjection(runtimeSchema, {
    kind: "fragment",
    schema: jsonSchema,
  });
}

/**
 * Explicitly retains an inherited structural view after adding runtime-only
 * refinements and records the operation-level refinement ids that document the
 * gap. An unacknowledged custom refinement makes projection fail.
 */
export function registerJsonSchemaRuntimeRefinements<
  RuntimeSchema extends z.ZodType,
>(
  runtimeSchema: RuntimeSchema,
  runtimeRefinements: readonly RuntimeRefinementReference[],
): RuntimeSchema {
  if (!hasCustomRefinement(runtimeSchema)) {
    throw new Error("Runtime refinement metadata requires a custom check");
  }

  const view = jsonSchemaViewRegistry.get(runtimeSchema);
  const projection = view && jsonSchemaViews.get(view.key);
  if (projection === undefined) {
    throw new Error(
      "Runtime refinements require a registered JSON Schema view",
    );
  }

  const ids = Array.from(
    new Set([
      ...(projection.runtimeRefinementIds ?? []),
      ...runtimeRefinements.map((refinement) => refinement.id),
    ]),
  );
  if (ids.length === 0) {
    throw new Error("Runtime refinements require at least one refinement id");
  }

  return registerProjection(
    runtimeSchema,
    projection.kind === "zod"
      ? {
          kind: "zod",
          runtimeRefinementIds: ids,
          schema: projection.schema,
        }
      : {
          kind: "fragment",
          runtimeRefinementIds: ids,
          schema: projection.schema,
        },
  );
}

function replaceJsonSchema(
  target: z.core.JSONSchema.BaseSchema,
  replacement: z.core.JSONSchema.BaseSchema,
): void {
  for (const key of Object.keys(target)) {
    Reflect.deleteProperty(target, key);
  }

  Object.assign(target, replacement);
}

function needsJsonSchemaView(schema: z.core.$ZodType): boolean {
  const definition = schema._zod.def;
  return (
    definition.type === "custom" ||
    (definition.type === "string" &&
      Reflect.get(definition, "format") !== undefined) ||
    hasCheckRequiringView(schema)
  );
}

function hasCustomRefinement(schema: z.core.$ZodType): boolean {
  return (
    schema._zod.def.checks?.some(
      (check) => check._zod.def.check === "custom",
    ) ?? false
  );
}

function hasValueOverwrite(schema: z.core.$ZodType): boolean {
  return (
    schema._zod.def.checks?.some(
      (check) => check._zod.def.check === "overwrite",
    ) ?? false
  );
}

function hasCheckRequiringView(schema: z.core.$ZodType): boolean {
  return (
    schema._zod.def.checks?.some(
      (check) => !isNativelyProjectedCheck(check._zod.def),
    ) ?? false
  );
}

function isNativelyProjectedCheck(definition: z.core.$ZodCheckDef): boolean {
  const when = Reflect.get(definition, "when");
  if (definition.check === "greater_than") {
    const value = Reflect.get(definition, "value");
    return (
      when === undefined && typeof value === "number" && Number.isFinite(value)
    );
  }
  if (definition.check !== "min_length") {
    return false;
  }

  const minimum = Reflect.get(definition, "minimum");
  return (
    Number.isInteger(minimum) &&
    minimum >= 0 &&
    (when === undefined ||
      (typeof when === "function" &&
        Function.prototype.toString.call(when) === nativeMinLengthWhenSource))
  );
}

function isJsonLiteral(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isReflectable(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

function isZodSchema(value: unknown): value is z.core.$ZodType {
  if (!isReflectable(value)) {
    return false;
  }

  const internals = Reflect.get(value, "_zod");
  if (!isReflectable(internals)) {
    return false;
  }

  const definition = Reflect.get(internals, "def");
  return (
    isReflectable(definition) &&
    typeof Reflect.get(definition, "type") === "string"
  );
}

function assertNestedJsonWireSchemas(
  value: unknown,
  location: string,
  seenSchemas: Set<z.core.$ZodType>,
  seenValues: WeakSet<object>,
): void {
  if (isZodSchema(value)) {
    assertJsonWireSchema(value, location, seenSchemas, seenValues);
    return;
  }
  if (typeof value !== "object" || value === null || seenValues.has(value)) {
    return;
  }

  seenValues.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) {
      continue;
    }
    const nestedValue =
      "value" in descriptor ? descriptor.value : Reflect.get(value, key);
    assertNestedJsonWireSchemas(
      nestedValue,
      `${location}.${String(key)}`,
      seenSchemas,
      seenValues,
    );
  }
}

function assertJsonWireSchema(
  schema: z.core.$ZodType,
  location: string,
  seenSchemas: Set<z.core.$ZodType>,
  seenValues: WeakSet<object>,
): void {
  if (seenSchemas.has(schema)) {
    return;
  }
  seenSchemas.add(schema);

  const definition = schema._zod.def;
  if (Reflect.get(definition, "coerce") === true) {
    throw new Error(`JSON wire schemas must not coerce values at ${location}`);
  }
  if (Reflect.get(definition, "normalize") === true) {
    throw new Error(
      `JSON wire schemas must not normalize values at ${location}`,
    );
  }
  if (hasValueOverwrite(schema)) {
    throw new Error(
      `JSON wire schemas must not overwrite values at ${location}`,
    );
  }
  if (forbiddenJsonWireSchemaTypes.has(definition.type)) {
    throw new Error(
      `JSON wire schemas must not use ${definition.type} at ${location}`,
    );
  }
  if (!supportedJsonWireSchemaTypes.has(definition.type)) {
    throw new Error(
      `Unsupported JSON wire schema type ${definition.type} at ${location}`,
    );
  }
  if (
    definition.type === "literal" &&
    Array.from(schema._zod.values ?? []).some((value) => !isJsonLiteral(value))
  ) {
    throw new Error(`JSON wire literals must be JSON values at ${location}`);
  }

  assertNestedJsonWireSchemas(definition, location, seenSchemas, seenValues);
}

function assertJsonWireSchemaRoot(schema: z.core.$ZodType): void {
  assertJsonWireSchema(schema, "root", new Set(), new WeakSet());
}

interface JsonSchemaOverrideContext {
  readonly jsonSchema: z.core.JSONSchema.BaseSchema;
  readonly path: readonly (number | string)[];
  readonly zodSchema: z.core.$ZodType;
}

function projectionJsonSchema(
  projection: JsonSchemaProjection,
  resolving: Set<z.core.$ZodType>,
  runtimeRefinementIds: Set<string>,
): z.core.JSONSchema.BaseSchema {
  if (projection.kind === "fragment") {
    return projection.schema;
  }
  return projectJsonSchema(projection.schema, resolving, runtimeRefinementIds);
}

function applyRegisteredView(
  context: JsonSchemaOverrideContext,
  view: JsonSchemaView | undefined,
  resolving: Set<z.core.$ZodType>,
  runtimeRefinementIds: Set<string>,
): boolean {
  if (view === undefined) {
    return false;
  }

  const projection = jsonSchemaViews.get(view.key);
  if (projection === undefined) {
    throw new Error(`Unknown JSON Schema view ${view.key}`);
  }
  for (const id of projection.runtimeRefinementIds ?? []) {
    runtimeRefinementIds.add(id);
  }
  replaceJsonSchema(
    context.jsonSchema,
    projectionJsonSchema(projection, resolving, runtimeRefinementIds),
  );
  return true;
}

function constrainNativeNumber(context: JsonSchemaOverrideContext): void {
  if (context.zodSchema._zod.def.type !== "number") {
    return;
  }

  const minimum = Reflect.get(context.jsonSchema, "minimum");
  if (
    typeof minimum !== "number" ||
    !Number.isFinite(minimum) ||
    minimum < -Number.MAX_VALUE
  ) {
    Reflect.set(context.jsonSchema, "minimum", -Number.MAX_VALUE);
  }

  const maximum = Reflect.get(context.jsonSchema, "maximum");
  if (
    typeof maximum !== "number" ||
    !Number.isFinite(maximum) ||
    maximum > Number.MAX_VALUE
  ) {
    Reflect.set(context.jsonSchema, "maximum", Number.MAX_VALUE);
  }
}

function overrideJsonSchema(
  context: JsonSchemaOverrideContext,
  resolving: Set<z.core.$ZodType>,
  runtimeRefinementIds: Set<string>,
): void {
  const location = context.path.join(".") || "root";
  const view = jsonSchemaViewRegistry.get(context.zodSchema);
  const hasDirectView = jsonSchemaViewRegistry.has(context.zodSchema);
  if (hasCustomRefinement(context.zodSchema) && !hasDirectView) {
    throw new Error(
      `Missing direct JSON Schema view for refinement at ${location}`,
    );
  }
  if (view !== undefined && !hasDirectView) {
    throw new Error(
      `Inherited JSON Schema view must be registered directly at ${location}`,
    );
  }
  if (applyRegisteredView(context, view, resolving, runtimeRefinementIds)) {
    return;
  }
  if (hasCheckRequiringView(context.zodSchema)) {
    throw new Error(`Missing direct JSON Schema view for check at ${location}`);
  }
  if (needsJsonSchemaView(context.zodSchema)) {
    throw new Error(
      `Missing JSON Schema view for ${context.zodSchema._zod.def.type} at ${location}`,
    );
  }
  constrainNativeNumber(context);
}

function projectJsonSchema(
  schema: z.core.$ZodType,
  resolving: Set<z.core.$ZodType>,
  runtimeRefinementIds: Set<string>,
): z.core.JSONSchema.BaseSchema {
  assertJsonWireSchemaRoot(schema);
  if (resolving.has(schema)) {
    throw new Error("JSON Schema views must not form a cycle");
  }

  resolving.add(schema);
  try {
    const result = z.toJSONSchema(schema, {
      io: "input",
      unrepresentable: "any",
      override(context) {
        overrideJsonSchema(context, resolving, runtimeRefinementIds);
      },
    });

    Reflect.deleteProperty(result, "$schema");
    return result;
  } finally {
    resolving.delete(schema);
  }
}

/**
 * Projects a runtime schema to JSON Schema 2020-12. Intentional custom
 * validators must register a structural view; unrepresentable schemas fail
 * closed instead of becoming unconstrained output.
 */
export function toJsonSchema(
  schema: z.core.$ZodType,
): z.core.JSONSchema.BaseSchema {
  return toJsonSchemaProjection(schema).jsonSchema;
}

interface JsonSchemaProjectionResult {
  readonly jsonSchema: z.core.JSONSchema.BaseSchema;
  readonly runtimeRefinementIds: readonly string[];
}

export function toJsonSchemaProjection(
  schema: z.core.$ZodType,
): JsonSchemaProjectionResult {
  const runtimeRefinementIds = new Set<string>();
  return {
    jsonSchema: projectJsonSchema(schema, new Set(), runtimeRefinementIds),
    runtimeRefinementIds: [...runtimeRefinementIds].sort(),
  };
}
