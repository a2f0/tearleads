import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { z } from "zod";
import {
  registerJsonSchemaFragment,
  registerJsonSchemaRuntimeRefinements,
  registerJsonSchemaView,
  toJsonSchema,
} from "./jsonSchema";

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

test("JSON Schema projection rejects unregistered schemas", () => {
  expect(() => toJsonSchema(z.custom(() => true))).toThrow(
    "Missing JSON Schema view for custom at root",
  );
  expect(() => toJsonSchema(z.date())).toThrow(
    "Unsupported JSON wire schema type date at root",
  );
  expect(() => toJsonSchema(z.literal(1n))).toThrow(
    "JSON wire literals must be JSON values at root",
  );
  expect(() => toJsonSchema(z.literal(Number.NaN))).toThrow(
    "JSON wire literals must be JSON values at root",
  );
  expect(() => toJsonSchema(z.literal(Number.POSITIVE_INFINITY))).toThrow(
    "JSON wire literals must be JSON values at root",
  );
  expect(toJsonSchema(z.number())).toEqual({
    maximum: Number.MAX_VALUE,
    minimum: -Number.MAX_VALUE,
    type: "number",
  });
  expect(toJsonSchema(z.number().positive())).toEqual({
    exclusiveMinimum: 0,
    maximum: Number.MAX_VALUE,
    minimum: -Number.MAX_VALUE,
    type: "number",
  });
  expect(() => toJsonSchema(z.number().gt(Number.POSITIVE_INFINITY))).toThrow(
    "Missing direct JSON Schema view for check at root",
  );
  expect(() => toJsonSchema(z.string().refine(() => true))).toThrow(
    "Missing direct JSON Schema view for refinement at root",
  );
  const registeredString = registerJsonSchemaView(z.string(), z.string());
  expect(() => toJsonSchema(registeredString.refine(() => true))).toThrow(
    "Missing direct JSON Schema view for refinement at root",
  );
  expect(() => toJsonSchema(registeredString.min(3))).toThrow(
    "Inherited JSON Schema view must be registered directly at root",
  );
  expect(() =>
    toJsonSchema(
      z
        .object({ value: z.string() })
        .check(z.property("value", z.string().min(3))),
    ),
  ).toThrow("Missing direct JSON Schema view for check at root");
  const conditionalMinimum = z.minLength(3);
  Reflect.set(conditionalMinimum._zod.def, "when", () => false);
  expect(() => toJsonSchema(z.string().check(conditionalMinimum))).toThrow(
    "Missing direct JSON Schema view for check at root",
  );
  expect(() => toJsonSchema(z.string().regex(/abc/i))).toThrow(
    "Missing direct JSON Schema view for check at root",
  );
  expect(() => toJsonSchema(z.jwt({ alg: "HS256" }))).toThrow(
    "Missing JSON Schema view for string at root",
  );
  expect(() =>
    registerJsonSchemaRuntimeRefinements(
      registerJsonSchemaView(z.string(), z.string()),
      [{ id: "phantom.refinement" }],
    ),
  ).toThrow("Runtime refinement metadata requires a custom check");
});

test("JSON Schema projection rejects non-identity wire schemas", () => {
  expect(() => toJsonSchema(z.object({ value: z.coerce.string() }))).toThrow(
    "JSON wire schemas must not coerce values at root.shape.value",
  );
  expect(() => toJsonSchema(z.string().catch("fallback"))).toThrow(
    "JSON wire schemas must not use catch at root",
  );
  expect(() => toJsonSchema(z.string().default("fallback"))).toThrow(
    "JSON wire schemas must not use default at root",
  );
  expect(() => toJsonSchema(z.string().trim())).toThrow(
    "JSON wire schemas must not overwrite values at root",
  );
  expect(() => toJsonSchema(z.url({ normalize: true }))).toThrow(
    "JSON wire schemas must not normalize values at root",
  );
  expect(() => toJsonSchema(z.lazy(() => z.string()))).toThrow(
    "JSON wire schemas must not use lazy at root",
  );
  expect(() => toJsonSchema(z.success(z.string()))).toThrow(
    "JSON wire schemas must not use success at root",
  );
  expect(() =>
    toJsonSchema(z.string().transform((value) => value.length)),
  ).toThrow("JSON wire schemas must not use pipe at root");
});
