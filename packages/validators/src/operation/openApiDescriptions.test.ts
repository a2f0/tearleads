import { expect, test } from "bun:test";
import { z } from "zod";
import { toJsonSchema } from "../jsonSchema";
import {
  describeSchema,
  JSON_SCHEMA_COMPONENT_KEY,
  JSON_SCHEMA_FIELD_DESCRIPTION_KEY,
} from "../jsonSchemaAnnotations";
import { loosePlainObject } from "../schema";
import { publishedOpenApiDocument } from "./openApi";
import { referenceOpenApiComponents } from "./openApiComponents";
import { protocolOperations } from "./registry";

const schemas = publishedOpenApiDocument.components.schemas;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads `node.properties[field]` from an untyped JSON Schema node. */
function propertyOf(node: unknown, field: string): unknown {
  const properties = isRecord(node)
    ? Reflect.get(node, "properties")
    : undefined;
  return isRecord(properties) ? properties[field] : undefined;
}

function componentOf(name: string): unknown {
  return Reflect.get(schemas, name);
}

test("every operation explains itself in plain prose", () => {
  for (const operation of protocolOperations) {
    const { description, id, summary } = operation;
    expect({ id, short: description.length < 40 }).toEqual({
      id,
      short: false,
    });
    expect(description).not.toBe(summary);
    // Rendered as plain text: no Markdown links, headings, or line breaks.
    expect({ id, markup: /\]\(|^#|\n/.test(description) }).toEqual({
      id,
      markup: false,
    });
  }
});

// The pinned oasdiff reports a description change inside an inline anyOf or
// oneOf branch as a breaking branch replacement, so these stay undescribed.
const UNDESCRIBABLE_COMPONENTS = [
  "DocumentEditAttributionRangeResponse",
  "OrganizationLeaveRequest",
];

test("every published component has a description", () => {
  const undescribed = Object.entries(schemas)
    .filter(
      ([, schema]) => typeof Reflect.get(schema, "description") !== "string",
    )
    .map(([name]) => name);
  expect(undescribed).toEqual(UNDESCRIBABLE_COMPONENTS);
});

test("a field description on a component stays beside its reference", () => {
  expect(
    propertyOf(componentOf("BlobAttachmentBindRequest"), "documentSync"),
  ).toEqual({
    $ref: "#/components/schemas/DocumentSyncRequest",
    description: expect.stringContaining("first queued update"),
  });
  expect(
    Reflect.get(Object(componentOf("DocumentSyncRequest")), "description"),
  ).toBe(
    "A document sync: uploads encrypted updates and asks for the ones the client is missing, one page at a time.",
  );
  const rendered = JSON.stringify(publishedOpenApiDocument);
  expect(rendered).not.toContain(JSON_SCHEMA_FIELD_DESCRIPTION_KEY);
  expect(rendered).not.toContain("x-tearleads-pending-field-descriptions");
});

test("describing keeps the schema instance and its validation", () => {
  const hash = z.string().min(64);
  const described = loosePlainObject({ hash });
  const plain = z.object({ hash });
  expect(
    describeSchema(described, "A described object.", {
      hash: "A described hash.",
    }),
  ).toBe(described);
  expect(described.safeParse({ hash: "ab" }).success).toBe(false);
  expect(described.safeParse({ hash: "ab".repeat(32) }).success).toBe(true);

  // Both objects share one field schema; only the described use changes.
  const projection = toJsonSchema(z.object({ plain, described, again: plain }));
  expect(propertyOf(projection, "described")).toMatchObject({
    description: "A described object.",
    properties: { hash: { description: "A described hash." } },
  });
  const plainProjection = propertyOf(projection, "plain");
  expect(plainProjection).not.toHaveProperty("description");
  expect(propertyOf(plainProjection, "hash")).not.toHaveProperty("description");

  expect(() => describeSchema(described, "Again.")).toThrow(
    "Schema is already described",
  );
  const typo = describeSchema(z.object({ a: z.string() }), "Typo.", {
    b: "No such field.",
  });
  expect(() => toJsonSchema(typo)).toThrow(
    "Described field b is not a projected property",
  );
});

test("a use-site description never changes the shared component", () => {
  const document = (paths: object) => ({ components: {}, paths });
  const named = (description: string) => ({
    [JSON_SCHEMA_COMPONENT_KEY]: "Thing",
    [JSON_SCHEMA_FIELD_DESCRIPTION_KEY]: description,
    description: "A thing.",
    type: "object",
  });
  expect(
    referenceOpenApiComponents(
      document({ a: named("First use."), b: named("Second use.") }),
    ),
  ).toEqual({
    components: {
      schemas: { Thing: { description: "A thing.", type: "object" } },
    },
    paths: {
      a: { $ref: "#/components/schemas/Thing", description: "First use." },
      b: { $ref: "#/components/schemas/Thing", description: "Second use." },
    },
  });
});
