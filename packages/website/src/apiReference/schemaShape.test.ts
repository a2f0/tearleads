import { describe, expect, test } from "bun:test";
import type { Inline } from "./constraints";
import type { JsonSchema } from "./openApiDocument";
import { createTextRenderer } from "./richText";
import { SchemaDescriber, type Shape } from "./schemaShape";

/** Plain text of inline parts, with code in backticks and links as [Name]. */
function flat(parts: Inline): string {
  return parts
    .map((part) => {
      if (part.kind === "text") return part.text;
      if (part.kind === "code") return `\`${part.text}\``;
      return `[${part.name}]`;
    })
    .join("");
}

function describeFixture(schema: JsonSchema): Shape {
  return new SchemaDescriber(createTextRenderer([])).describe(
    schema,
    "fixture",
  );
}

function summary(shape: Shape) {
  return {
    type: flat(shape.type),
    nullable: shape.nullable,
    constraints: shape.constraints.map(flat),
  };
}

describe("types and constraints in words", () => {
  test("strings: length, named and unnamed patterns, formats, literals", () => {
    expect(
      summary(describeFixture({ type: "string", minLength: 1, maxLength: 64 })),
    ).toEqual({
      type: "string",
      nullable: false,
      constraints: ["1 to 64 characters"],
    });
    expect(
      summary(describeFixture({ type: "string", minLength: 1 })).constraints,
    ).toEqual(["not empty"]);
    expect(
      summary(
        describeFixture({
          type: "string",
          minLength: 64,
          maxLength: 64,
          pattern: "^[0-9a-f]+$",
        }),
      ).constraints,
    ).toEqual(["exactly 64 characters", "lowercase hexadecimal"]);
    expect(
      summary(
        describeFixture({ type: "string", pattern: "^[A-Za-z0-9_-]{43}$" }),
      ).constraints,
    ).toEqual(["base64url, pattern `^[A-Za-z0-9_-]{43}$`"]);
    expect(
      summary(describeFixture({ type: "string", pattern: "^v[0-9]$" }))
        .constraints,
    ).toEqual(["pattern `^v[0-9]$`"]);
    expect(
      summary(describeFixture({ type: "string", format: "binary" })),
    ).toEqual({
      type: "bytes",
      nullable: false,
      constraints: ["raw bytes"],
    });
    expect(
      summary(describeFixture({ type: "string", enum: ["admin", "member"] }))
        .constraints,
    ).toEqual(["one of `admin`, `member`"]);
    expect(
      summary(describeFixture({ type: "string", const: "v1" })).constraints,
    ).toEqual(["always `v1`"]);
    expect(
      summary(
        describeFixture({ type: "string", "x-extensible-enum": ["a", "b"] }),
      ).constraints,
    ).toEqual(["known values `a`, `b`; other values may appear"]);
  });

  test("numbers drop Zod's safe-integer and float limits", () => {
    expect(
      summary(
        describeFixture({
          type: "integer",
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        }),
      ).constraints,
    ).toEqual(["at least 0"]);
    expect(
      summary(
        describeFixture({
          type: "number",
          minimum: -Number.MAX_VALUE,
          maximum: Number.MAX_VALUE,
        }),
      ).constraints,
    ).toEqual([]);
    expect(
      summary(describeFixture({ type: "integer", minimum: 1, maximum: 200 }))
        .constraints,
    ).toEqual(["1 to 200"]);
    expect(
      summary(describeFixture({ type: "integer", exclusiveMinimum: 0 }))
        .constraints,
    ).toEqual(["greater than 0"]);
    expect(
      summary(describeFixture({ type: "integer", maximum: 33554432 }))
        .constraints,
    ).toEqual(["at most 33,554,432"]);
  });

  test("lists, maps, references, and nullability", () => {
    expect(
      summary(
        describeFixture({
          type: "array",
          maxItems: 500,
          items: { $ref: "#/components/schemas/ContainerManifest" },
        }),
      ),
    ).toEqual({
      type: "list of [ContainerManifest]",
      nullable: false,
      constraints: ["at most 500 items"],
    });
    expect(
      summary(
        describeFixture({
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 },
        }),
      ).constraints,
    ).toEqual(["at least 1 item", "each item: not empty"]);
    expect(
      summary(
        describeFixture({
          type: "object",
          propertyNames: { type: "string" },
          additionalProperties: { $ref: "#/components/schemas/Bundle" },
        }),
      ).type,
    ).toBe("map of string to [Bundle]");
    expect(
      summary(
        describeFixture({
          anyOf: [{ $ref: "#/components/schemas/Head" }, { type: "null" }],
        }),
      ),
    ).toEqual({ type: "[Head]", nullable: true, constraints: [] });
    expect(summary(describeFixture({}))).toMatchObject({
      type: "any JSON value",
    });
    expect(summary(describeFixture({ not: {} }))).toMatchObject({
      type: "never present",
    });
    expect(
      summary(describeFixture({ type: "string", not: { const: "TRANSFER" } }))
        .constraints,
    ).toEqual(["not `TRANSFER`"]);
  });

  test("unions: literals collapse, other alternatives become variants", () => {
    expect(
      summary(
        describeFixture({
          anyOf: [{ type: "string", const: "tracked" }, { const: "none" }],
        }),
      ),
    ).toEqual({
      type: "string",
      nullable: false,
      constraints: ["one of `tracked`, `none`"],
    });
    const union = describeFixture({
      oneOf: [
        { type: "string" },
        {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      ],
    });
    expect(flat(union.type)).toBe("one of: string, object");
    expect(union.variants.map((variant) => flat(variant.type))).toEqual([
      "string",
      "object",
    ]);
    expect(union.variants[1]?.fields.map((field) => field.name)).toEqual([
      "id",
    ]);
  });

  test("objects list fields in order with required, nullable, and descriptions", () => {
    const shape = describeFixture({
      type: "object",
      description: "A `v1` thing.",
      properties: {
        id: { type: "string", description: "The id." },
        parent: {
          anyOf: [
            { type: "object", properties: { at: { type: "integer" } } },
            { type: "null" },
          ],
        },
      },
      required: ["id"],
      additionalProperties: {},
    });
    expect(shape.otherFields).toBe(true);
    expect(shape.description).toEqual([
      [
        { kind: "text", text: "A " },
        { kind: "code", text: "v1" },
        { kind: "text", text: " thing." },
      ],
    ]);
    expect(
      shape.fields.map((field) => [
        field.name,
        field.required,
        field.shape.nullable,
      ]),
    ).toEqual([
      ["id", true, false],
      ["parent", false, true],
    ]);
    expect(shape.fields[0]?.shape.description).toEqual([
      [{ kind: "text", text: "The id." }],
    ]);
    expect(shape.fields[1]?.shape.fields.map((field) => field.name)).toEqual([
      "at",
    ]);
    expect(
      describeFixture({ type: "object", additionalProperties: false }).type,
    ).toEqual([{ kind: "text", text: "empty object" }]);
    // JSON Schema allows unlisted fields unless additionalProperties is false.
    const listed = { type: "object", properties: { a: { type: "string" } } };
    expect(describeFixture(listed).otherFields).toBe(true);
    expect(
      describeFixture({ ...listed, additionalProperties: false }).otherFields,
    ).toBe(false);
  });
});

describe("unhandled schema fails the build", () => {
  test.each([
    [
      { type: "array", prefixItems: [{ type: "string" }] },
      /keyword "prefixItems" anywhere/,
    ],
    [{ allOf: [{ type: "string" }] }, /keyword "allOf" anywhere/],
    [{ type: "string", minItems: 1 }, /keyword "minItems" here/],
    [{ type: "string", format: "uri" }, /unsupported "uri"/],
    [{ type: ["string", "null"] }, /unsupported \["string","null"\]/],
    [
      {
        type: "object",
        properties: { a: { type: "string" } },
        additionalProperties: { type: "string" },
      },
      /typed extra fields/,
    ],
    [
      { type: "object", properties: { a: {} }, required: ["b"] },
      /b is not a property/,
    ],
    [{ $ref: "#/definitions/X" }, /Unsupported \$ref/],
    [{ not: { type: "string" } }, /only \{\} and \{ const \}/],
  ])("%j", (schema, message) => {
    expect(() => describeFixture(schema)).toThrow(message);
  });

  test("a nested unhandled keyword names its location", () => {
    expect(() =>
      describeFixture({
        type: "object",
        properties: {
          list: { type: "array", items: { type: "string", uniqueItems: true } },
        },
      }),
    ).toThrow(/fixture\.list\[\]: .*"uniqueItems"/);
  });
});
