import { z } from "zod";
import { isPlainObject } from "./isPlainObject";
import {
  registerJsonSchemaFragment,
  registerJsonSchemaView,
  toJsonSchema,
} from "./jsonSchema";
import {
  AUTH_CHALLENGE_HEX_LENGTH,
  isAuthChallengeHexString,
  isByteArrayOfLength,
  isSha256HexString,
  SHA256_HEX_LENGTH,
} from "./util";

const LOWERCASE_HEX_PATTERN = "^[0-9a-f]+$";

export const sha256HexStringSchema = registerJsonSchemaFragment(
  z.custom<string>(isSha256HexString),
  {
    maxLength: SHA256_HEX_LENGTH,
    minLength: SHA256_HEX_LENGTH,
    pattern: LOWERCASE_HEX_PATTERN,
    type: "string",
  },
);

export const authChallengeHexStringSchema = registerJsonSchemaFragment(
  z.custom<string>(isAuthChallengeHexString),
  {
    maxLength: AUTH_CHALLENGE_HEX_LENGTH,
    minLength: AUTH_CHALLENGE_HEX_LENGTH,
    pattern: LOWERCASE_HEX_PATTERN,
    type: "string",
  },
);

export function fixedLengthByteArraySchema(length: number) {
  return registerJsonSchemaFragment(
    z.custom<number[]>((value) => isByteArrayOfLength(value, length)),
    {
      items: {
        maximum: 255,
        minimum: 0,
        type: "integer",
      },
      maxItems: length,
      minItems: length,
      type: "array",
    },
  );
}

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
  /** Optional item ceiling, reflected in the generated JSON Schema. */
  maxItems?: number,
) {
  const viewSchema = z.array(itemSchema);
  const runtimeSchema = registerJsonSchemaView(
    z.custom<z.output<ItemSchema>[]>(Array.isArray),
    viewSchema,
  ).superRefine((values, context) => {
    if (maxItems !== undefined && values.length > maxItems) {
      context.addIssue({
        code: "custom",
        message: `array exceeds ${maxItems} items`,
      });
    }
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

  if (maxItems === undefined) {
    return registerJsonSchemaView(runtimeSchema, viewSchema);
  }
  // The projector rejects checks on a registered view, so the advertised
  // ceiling is attached as an explicit fragment instead — the generated
  // OpenAPI carries maxItems, and the runtime refinement above enforces it.
  return registerJsonSchemaFragment(runtimeSchema, {
    // Project the item through this package's own projector so the emitted
    // item schema — and the types generated from it — stay identical to the
    // unbounded case; only maxItems is added.
    items: toJsonSchema(itemSchema),
    maxItems,
    type: "array",
  });
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
