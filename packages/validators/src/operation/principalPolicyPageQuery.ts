import { z } from "zod";
import { registerJsonSchemaFragment } from "../jsonSchema";
import { sha256HexStringSchema } from "../schema";

const cursorJsonSchema = {
  type: "integer",
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
} as const;
const cursorInput = registerJsonSchemaFragment(
  z.union([z.string(), z.number()]).refine((value) => {
    if (typeof value === "string" && !/^(0|[1-9][0-9]*)$/.test(value))
      return false;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0;
  }),
  cursorJsonSchema,
);
const afterVersion = registerJsonSchemaFragment(
  cursorInput.transform(Number),
  cursorJsonSchema,
);

const headVersion = registerJsonSchemaFragment(
  cursorInput.transform(Number).refine((value) => value >= 1),
  { ...cursorJsonSchema, minimum: 1 },
);

/**
 * `stateHash` and `afterVersion` pin delivery to one exact head. The
 * `ifVersion` and `ifStateHash` pair makes an unpinned discovery read
 * conditional: when the live head is exactly that pair, the reply carries the
 * head alone. The API refuses a partial pair or one combined with a pin, as it
 * refuses a cursor without a pin.
 */
export const PrincipalPolicyPageQuerySchema = z.strictObject({
  afterVersion: afterVersion.optional(),
  stateHash: sha256HexStringSchema.optional(),
  ifVersion: headVersion.optional(),
  ifStateHash: sha256HexStringSchema.optional(),
});

export type PrincipalPolicyPageQuery = z.infer<
  typeof PrincipalPolicyPageQuerySchema
>;
