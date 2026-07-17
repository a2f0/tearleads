import { z } from "zod";
import { isPlainObject } from "./isPlainObject";

export const plainObjectSchema =
  z.custom<Record<string, unknown>>(isPlainObject);

export const positiveIntegerSchema = z
  .number()
  .positive()
  .refine(Number.isInteger);

export const nonEmptyStringSchema = z.string().min(1);

/**
 * Validates array items without rebuilding the array. This preserves signed
 * input identity and the legacy guards' treatment of sparse array holes.
 */
export function arraySchema<ItemSchema extends z.ZodType>(
  itemSchema: ItemSchema,
) {
  return z
    .custom<z.output<ItemSchema>[]>(Array.isArray)
    .superRefine((values, context) => {
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
}

export function nonEmptyArraySchema<ItemSchema extends z.ZodType>(
  itemSchema: ItemSchema,
) {
  return arraySchema(itemSchema).refine((values) => values.length > 0);
}

/**
 * Validates a shaped plain object without returning Zod's reconstructed
 * loose-object output. Extension keys, prototypes, and signed input identity
 * remain untouched. These compatibility helpers are intentionally a runtime
 * validation seam, not the future JSON Schema/OpenAPI generation seam.
 */
export function loosePlainObject<Shape extends z.ZodRawShape>(shape: Shape) {
  const shapeSchema = z.looseObject(shape);

  return z
    .custom<z.output<typeof shapeSchema>>(isPlainObject)
    .superRefine((value, context) => {
      const result = shapeSchema.safeParse(value);
      if (result.success) {
        return;
      }

      for (const issue of result.error.issues) {
        context.addIssue({ ...issue });
      }
    });
}
