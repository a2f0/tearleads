import { expect, test } from "bun:test";
import { z } from "zod";
import { registerJsonSchemaFragment, toJsonSchema } from "./jsonSchema";

test("registered input transforms retain their JSON wire schema", () => {
  expect(
    toJsonSchema(
      registerJsonSchemaFragment(
        z.string().transform((value) => value.length),
        { type: "string" },
      ),
    ),
  ).toEqual({ type: "string" });
});

test("registered input transforms cannot hide input coercion", () => {
  expect(() =>
    toJsonSchema(
      registerJsonSchemaFragment(
        z.coerce.string().transform((value) => value.length),
        { type: "string" },
      ),
    ),
  ).toThrow("JSON wire schemas must not coerce values at root.input");
});
