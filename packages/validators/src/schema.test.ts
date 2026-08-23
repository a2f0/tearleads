import { expect, test } from "bun:test";
import { z } from "zod";
import { registerJsonSchemaFragment } from "./jsonSchema";
import { arraySchema } from "./schema";

test("bounded arrays reject adversarial cardinality before parsing items", () => {
  let parsedItemCount = 0;
  const itemSchema = registerJsonSchemaFragment(
    z.custom(() => {
      parsedItemCount += 1;
      return false;
    }),
    { type: "null" },
  );
  const adversarialInput = Array.from({ length: 1_000_000 }, () => null);

  const result = arraySchema(itemSchema, 64).safeParse(adversarialInput);

  expect(result.success).toBe(false);
  expect(parsedItemCount).toBe(0);
  if (result.success) {
    throw new Error("Expected the adversarial array to be rejected");
  }
  expect(result.error.issues).toEqual([
    {
      code: "custom",
      message: "array exceeds 64 items",
      path: [],
    },
  ]);
});
