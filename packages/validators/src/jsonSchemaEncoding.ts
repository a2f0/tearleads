import type { z } from "zod";

type JsonSchema = z.core.JSONSchema.BaseSchema;

export function preserveDiscriminatedUnionEncoding(
  schema: z.core.$ZodType,
  jsonSchema: JsonSchema,
): void {
  // Discriminator values are disjoint, so anyOf retains the established
  // encoding of nested unions. Keep oneOf for XOR unions, whose branches can overlap.
  if (
    schema._zod.def.type === "union" &&
    typeof Reflect.get(schema._zod.def, "discriminator") === "string" &&
    jsonSchema.oneOf
  ) {
    jsonSchema.anyOf = jsonSchema.oneOf;
    delete jsonSchema.oneOf;
  }
}

const schemaMaps = [
  "$defs",
  "properties",
  "patternProperties",
  "dependentSchemas",
] as const;
const schemaChildren = [
  "additionalItems",
  "unevaluatedItems",
  "prefixItems",
  "items",
  "contains",
  "additionalProperties",
  "unevaluatedProperties",
  "propertyNames",
  "if",
  "then",
  "else",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
] as const;

export function preserveTypeUnionEncoding(schema: JsonSchema): void {
  // Zod 4.5 compacts these after its override hook. Keep the established
  // OpenAPI encoding so consumers and compatibility checks see a stable API.
  if (Array.isArray(schema.type)) {
    const union = schema.type.map((type) => ({ type }));
    delete schema.type;
    if (schema.anyOf) {
      schema.allOf = [...(schema.allOf ?? []), { anyOf: union }];
    } else {
      schema.anyOf = union;
    }
  }
  for (const key of schemaMaps) {
    const children = schema[key];
    if (children && typeof children === "object") {
      for (const child of Object.values(children)) {
        visitSchema(child);
      }
    }
  }
  for (const key of schemaChildren) {
    const child = schema[key];
    if (Array.isArray(child)) {
      for (const item of child) visitSchema(item);
    } else {
      visitSchema(child);
    }
  }
}

function visitSchema(value: JsonSchema | boolean | undefined): void {
  if (value && typeof value === "object") {
    preserveTypeUnionEncoding(value);
  }
}

export function constrainNativeNumber(
  zodSchema: z.core.$ZodType,
  jsonSchema: JsonSchema,
): void {
  if (zodSchema._zod.def.type !== "number") {
    return;
  }

  const minimum = Reflect.get(jsonSchema, "minimum");
  if (
    typeof minimum !== "number" ||
    !Number.isFinite(minimum) ||
    minimum < -Number.MAX_VALUE
  ) {
    Reflect.set(jsonSchema, "minimum", -Number.MAX_VALUE);
  }

  const maximum = Reflect.get(jsonSchema, "maximum");
  if (
    typeof maximum !== "number" ||
    !Number.isFinite(maximum) ||
    maximum > Number.MAX_VALUE
  ) {
    Reflect.set(jsonSchema, "maximum", Number.MAX_VALUE);
  }
}
