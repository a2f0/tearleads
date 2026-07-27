import { z } from "zod";
import { isPlainObject } from "./isPlainObject";
import {
  registerJsonSchemaFragment,
  registerJsonSchemaView,
} from "./jsonSchema";

export const plainObjectSchema = registerJsonSchemaView(
  z.custom<Record<string, unknown>>(isPlainObject),
  z.looseObject({}),
);

export const positiveIntegerSchema = registerJsonSchemaFragment(
  z.number().positive().refine(Number.isInteger),
  {
    exclusiveMinimum: 0,
    maximum: Number.MAX_VALUE,
    type: "integer",
  },
);

export const nonEmptyStringSchema = z.string().min(1);

/**
 * Validates array items without rebuilding the array. This preserves signed
 * input identity and the runtime contract's treatment of sparse array holes.
 */
export function arraySchema<ItemSchema extends z.ZodType>(
  itemSchema: ItemSchema,
) {
  const viewSchema = z.array(itemSchema);
  const runtimeSchema = registerJsonSchemaView(
    z.custom<z.output<ItemSchema>[]>(Array.isArray),
    viewSchema,
  ).superRefine((values, context) => {
    values.forEach((value, index) => {
      const result = itemSchema.safeParse(value);
      if (result.success) {
        return;
      }

      for (const issue of result.error.issues) {
        context.addIssue({ ...issue, path: [index, ...issue.path] });
      }
    });
  });

  return registerJsonSchemaView(runtimeSchema, viewSchema);
}

export function nonEmptyArraySchema<ItemSchema extends z.ZodType>(
  itemSchema: ItemSchema,
) {
  return registerJsonSchemaView(
    arraySchema(itemSchema).refine((values) => values.length > 0),
    z.array(itemSchema).min(1),
  );
}

/**
 * Validates a shaped plain object without returning Zod's reconstructed
 * loose-object output. Extension keys, prototypes, and signed input identity
 * remain untouched. A separate structural view describes the JSON wire shape
 * for OpenAPI without changing the value returned by runtime validation.
 */
export function loosePlainObject<Shape extends z.ZodRawShape>(shape: Shape) {
  const shapeSchema = z.looseObject(shape);

  const runtimeSchema = registerJsonSchemaView(
    z.custom<z.output<typeof shapeSchema>>(isPlainObject),
    shapeSchema,
  ).superRefine((value, context) => {
    const result = shapeSchema.safeParse(value);
    if (result.success) {
      return;
    }

    for (const issue of result.error.issues) {
      context.addIssue({ ...issue });
    }
  });

  return registerJsonSchemaView(runtimeSchema, shapeSchema);
}
