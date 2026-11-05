import { expect, test } from "bun:test";
import { z } from "zod";
import { JSON_SCHEMA_COMPONENT_KEY } from "../jsonSchemaAnnotations";
import { ErrorResponseSchema } from "../response/error";
import { plainObjectSchema } from "../schema";
import { openApiDocument, publishedOpenApiDocument } from "./openApi";
import {
  collectOpenApiComponentNames,
  referenceOpenApiComponents,
  resolveOpenApiComponents,
} from "./openApiComponents";
import {
  httpStatusDescription,
  openApiOperationTag,
} from "./openApiPresentation";
import { protocolOperations } from "./registry";

const schemas = publishedOpenApiDocument.components.schemas;

test("resolving the published components gives back the inline document", () => {
  expect(
    resolveOpenApiComponents(publishedOpenApiDocument.paths, schemas),
  ).toEqual(openApiDocument.paths);
  expect(Object.keys(schemas).length).toBeGreaterThan(100);
});

test("the published document defines each named schema once", () => {
  const rendered = JSON.stringify(publishedOpenApiDocument);
  expect(rendered).not.toContain(JSON_SCHEMA_COMPONENT_KEY);
  const referenced = new Set(
    Array.from(
      rendered.matchAll(/"#\/components\/schemas\/([^"]+)"/g),
      (match) => match[1],
    ),
  );
  expect([...referenced].sort()).toEqual(Object.keys(schemas));
  expect(
    publishedOpenApiDocument.paths["/auth/challenge"]?.post?.requestBody,
  ).toEqual({
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ChallengeRequest" },
      },
    },
    required: true,
  });
});

test("an aliased schema takes its shortest export name", () => {
  expect(collectOpenApiComponentNames().get(ErrorResponseSchema)).toBe(
    "ErrorResponse",
  );
  expect(Object.hasOwn(schemas, "ErrorResponse")).toBe(true);
  expect(Object.hasOwn(schemas, "ChallengeErrorResponse")).toBe(false);
});

test("generic building blocks stay unnamed behind specific aliases", () => {
  expect(collectOpenApiComponentNames().get(plainObjectSchema)).toBeUndefined();
  expect(Object.hasOwn(schemas, "StripeWebhookRequest")).toBe(false);
});

test("named scalars stay inline and conflicting projections fail", () => {
  const document = (paths: object) => ({ components: {}, paths });
  const named = (extra: object) => ({
    [JSON_SCHEMA_COMPONENT_KEY]: "Thing",
    type: "object",
    ...extra,
  });

  expect(
    referenceOpenApiComponents(
      document({ a: { [JSON_SCHEMA_COMPONENT_KEY]: "Id", type: "string" } }),
    ),
  ).toEqual({ components: { schemas: {} }, paths: { a: { type: "string" } } });
  expect(() =>
    referenceOpenApiComponents(
      document({ a: named({}), b: named({ required: ["x"] }) }),
    ),
  ).toThrow("OpenAPI component Thing projects inconsistently");
  expect(() =>
    resolveOpenApiComponents({ $ref: "#/components/schemas/Missing" }, {}),
  ).toThrow("Unknown OpenAPI component reference #/components/schemas/Missing");
  expect(collectOpenApiComponentNames().get(z.object({}))).toBeUndefined();
});

test("every operation carries a summary, a tag, and named statuses", () => {
  for (const operation of protocolOperations) {
    expect(operation.summary.trim().length).toBeGreaterThan(0);
    expect(openApiOperationTag(operation).length).toBeGreaterThan(0);
  }
  expect(openApiOperationTag({ id: "organizations.billing.get" })).toBe(
    "Organization billing",
  );
  expect(openApiOperationTag({ id: "organizations.create" })).toBe(
    "Organizations",
  );
  expect(() => openApiOperationTag({ id: "unknown.get" })).toThrow(
    "unknown.get has no OpenAPI tag",
  );
  expect(httpStatusDescription(409)).toBe("Conflict");
  expect(() => httpStatusDescription(418)).toThrow(
    "HTTP status 418 has no OpenAPI description",
  );
});
