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

export const PrincipalPolicyPageQuerySchema = z.strictObject({
  afterVersion: afterVersion.optional(),
  stateHash: sha256HexStringSchema.optional(),
});

export type PrincipalPolicyPageQuery = z.infer<
  typeof PrincipalPolicyPageQuerySchema
>;
