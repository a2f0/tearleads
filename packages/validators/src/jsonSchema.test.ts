import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
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

test("nullable unions retain their OpenAPI encoding and validation", () => {
  const schema = z.object({ value: z.string().nullable() });
  const projected = toJsonSchema(schema);
  const { value: valueSchema } = projected.properties ?? {};
  expect(valueSchema).toEqual({
    anyOf: [{ type: "string" }, { type: "null" }],
  });
  const validate = new Ajv2020().compile(projected);
  for (const value of [{ value: null }, { value: "text" }, { value: 7 }, {}]) {
    expect(validate(value)).toBe(schema.safeParse(value).success);
  }
});

test("discriminated unions retain anyOf while XOR unions remain exclusive", () => {
  const schema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), value: z.string() }),
    z.object({ kind: z.literal("number"), value: z.number() }),
  ]);
  const projected = toJsonSchema(z.object({ value: schema }));
  expect(toJsonSchema(schema)).toHaveProperty("oneOf");
  const { value: valueSchema } = projected.properties ?? {};
  expect(valueSchema).toHaveProperty("anyOf");
  expect(valueSchema).not.toHaveProperty("oneOf");
  const validate = new Ajv2020().compile(projected);
  for (const value of [
    { kind: "text", value: "text" },
    { kind: "number", value: 7 },
    { kind: "text", value: 7 },
    { kind: "other", value: "text" },
  ]) {
    expect(validate({ value })).toBe(schema.safeParse(value).success);
  }
  const exclusive = z.xor([z.string(), z.literal("overlap")]);
  const validateExclusive = new Ajv2020().compile(toJsonSchema(exclusive));
  for (const value of ["text", "overlap", null]) {
    expect(validateExclusive(value)).toBe(exclusive.safeParse(value).success);
  }
});

test("union encoding leaves literal metadata untouched", () => {
  const example = { type: ["string", "null"] };
  expect(
    toJsonSchema(
      registerJsonSchemaFragment(z.unknown(), {
        type: ["string", "null"],
        examples: [example],
        default: example,
      }),
    ),
  ).toEqual({
    anyOf: [{ type: "string" }, { type: "null" }],
    examples: [example],
    default: example,
  });
});
