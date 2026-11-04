import { z } from "zod";

/** Names a projected schema; the OpenAPI renderer moves it to components. */
export const JSON_SCHEMA_COMPONENT_KEY = "x-tearleads-component";

/**
 * A field's description on a named component. The OpenAPI renderer puts it
 * beside the field's `$ref`, so it does not change the shared component.
 */
export const JSON_SCHEMA_FIELD_DESCRIPTION_KEY =
  "x-tearleads-field-description";

type FieldDescriptions = Readonly<Record<string, string>>;

const fieldDescriptionRegistry = z.registry<{
  readonly fields: FieldDescriptions;
}>();

/**
 * Describes a wire schema, and optionally its fields, for readers of the
 * generated JSON Schema and OpenAPI document. Descriptions are Zod metadata on
 * the given instance: `.describe()` and `.meta()` would return a clone, which
 * loses the OpenAPI component name (components are named by schema identity)
 * and any registered JSON Schema view. Validation is unchanged.
 *
 * Field descriptions name properties of the projected object; one on a field
 * whose schema is a named component overrides that component's description
 * at this use only.
 */
export function describeSchema<Schema extends z.core.$ZodType>(
  schema: Schema,
  description: string,
  fields?: FieldDescriptions,
): Schema {
  if (z.globalRegistry.has(schema) || fieldDescriptionRegistry.has(schema)) {
    throw new Error(`Schema is already described: ${description}`);
  }
  z.globalRegistry.add(schema, { description });
  if (fields !== undefined) {
    fieldDescriptionRegistry.add(schema, { fields });
  }
  return schema;
}

interface AnnotationContext {
  readonly jsonSchema: z.core.JSONSchema.BaseSchema;
  readonly zodSchema: z.core.$ZodType;
}

// Carries a node's field descriptions until projection has finished.
const PENDING_FIELD_DESCRIPTIONS_KEY = "x-tearleads-pending-field-descriptions";

function isNode(value: unknown): value is z.core.JSONSchema.BaseSchema {
  return typeof value === "object" && value !== null;
}

function isFieldDescriptions(value: unknown): value is FieldDescriptions {
  return (
    isNode(value) &&
    Object.values(value).every((description) => typeof description === "string")
  );
}

function describeProperties(
  node: z.core.JSONSchema.BaseSchema,
  fields: FieldDescriptions,
): void {
  const { properties } = node;
  for (const [name, description] of Object.entries(fields)) {
    const property = properties?.[name];
    if (properties === undefined || typeof property !== "object") {
      throw new Error(`Described field ${name} is not a projected property`);
    }
    // Write a copy: the description belongs to this use of the field schema.
    properties[name] =
      JSON_SCHEMA_COMPONENT_KEY in property
        ? { ...property, [JSON_SCHEMA_FIELD_DESCRIPTION_KEY]: description }
        : { ...property, description };
  }
}

function applyFieldDescriptions(value: unknown, seen: Set<object>): void {
  if (!isNode(value) || seen.has(value)) {
    return;
  }
  seen.add(value);
  for (const child of Object.values(value)) {
    applyFieldDescriptions(child, seen);
  }
  const fields = Reflect.get(value, PENDING_FIELD_DESCRIPTIONS_KEY);
  if (fields === undefined) {
    return;
  }
  if (!isFieldDescriptions(fields)) {
    throw new Error("Pending field descriptions are malformed");
  }
  Reflect.deleteProperty(value, PENDING_FIELD_DESCRIPTIONS_KEY);
  describeProperties(value, fields);
}

/**
 * Applies descriptions and component names while a schema projects. A
 * registered view replaces the node Zod built, metadata included, so the
 * description is written again after the view. Field descriptions are applied
 * to the finished projection, once every property node is final.
 */
export function createJsonSchemaAnnotationPass(
  componentNames: ReadonlyMap<z.core.$ZodType, string>,
) {
  let hasFieldDescriptions = false;
  return {
    apply(projection: z.core.JSONSchema.BaseSchema): void {
      if (hasFieldDescriptions) {
        applyFieldDescriptions(projection, new Set());
      }
    },
    record({ jsonSchema, zodSchema }: AnnotationContext): void {
      const description = z.globalRegistry.get(zodSchema)?.description;
      if (description !== undefined) {
        jsonSchema.description = description;
      }
      const fields = fieldDescriptionRegistry.get(zodSchema)?.fields;
      if (fields !== undefined) {
        hasFieldDescriptions = true;
        Reflect.set(jsonSchema, PENDING_FIELD_DESCRIPTIONS_KEY, fields);
      }
      const name = componentNames.get(zodSchema);
      if (name !== undefined) {
        Reflect.set(jsonSchema, JSON_SCHEMA_COMPONENT_KEY, name);
      }
    },
  };
}
