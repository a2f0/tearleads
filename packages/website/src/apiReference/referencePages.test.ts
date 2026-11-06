import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { docPath, technicalDocPages } from "../technicalDocs";
import { parseApiDocument } from "./openApiDocument";
import { createApiReference, refinementSentence } from "./referencePages";
import type { RichText } from "./richText";
import { handledKeywords } from "./schemaShape";

const repository = resolve(import.meta.dir, "../../../..");
const openApiText = readFileSync(
  resolve(repository, "docs/openapi.json"),
  "utf8",
);
const glossary = technicalDocPages
  .filter((doc) => doc.parent === "glossary")
  .map((doc) => ({
    path: docPath(doc),
    markdown: readFileSync(resolve(repository, doc.source), "utf8"),
  }));
const reference = createApiReference(openApiText, glossary);

/** Every key of every object in the document's schemas, recursively. */
function schemaKeywords(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) schemaKeywords(item, into);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      into.add(key);
      // Property maps hold field names, not keywords.
      if (key === "properties" && typeof item === "object" && item !== null) {
        for (const field of Object.values(item)) schemaKeywords(field, into);
      } else {
        schemaKeywords(item, into);
      }
    }
  }
  return into;
}

function mentions(text: RichText): string[] {
  return text.flatMap((paragraph) =>
    paragraph.filter((part) => part.kind === "term").map((part) => part.text),
  );
}

test("every operation and schema in docs/openapi.json renders", () => {
  for (const operation of reference.document.operations) {
    const page = reference.operationPage(operation);
    expect(page.responses.length, operation.operationId).toBeGreaterThan(0);
  }
  for (const name of reference.document.schemas.keys()) {
    expect(reference.schemaPage(name).name).toBe(name);
  }
  expect(reference.index().groups.length).toBe(reference.document.tags.length);
});

test("the document uses only keywords the renderer handles", () => {
  const { document } = reference;
  const used = schemaKeywords([
    ...document.schemas.values(),
    ...document.operations.flatMap((operation) => [
      ...operation.parameters.map((parameter) => parameter.schema),
      operation.requestBody?.schema,
      ...operation.responses.flatMap((response) => [
        response.body?.schema,
        ...response.headers.map((header) => header.schema),
      ]),
    ]),
  ]);
  expect([...used].filter((key) => !handledKeywords.has(key))).toEqual([]);
});

test("a request body named by $ref shows that schema's fields", () => {
  const create = reference.document.operations.find(
    (operation) => operation.operationId === "organizations.create",
  );
  if (create === undefined) throw new Error("organizations.create missing");
  const page = reference.operationPage(create);
  expect(page.requestBody?.schemaName).toBe("CreateOrganizationRequest");
  expect(page.requestBody?.shape.fields.map((field) => field.name)).toContain(
    "initialRootContainer",
  );
  const ok = page.responses.find((response) => response.status === "200");
  expect(ok?.expanded).toBe(true);
  expect(ok?.body?.shape.fields.length).toBeGreaterThan(0);
  const conflict = page.responses.find((response) => response.status === "409");
  expect(conflict?.expanded).toBe(false);
  expect(conflict?.body?.shape.fields).toEqual([]);
  // Refinements link glossary terms, once per page.
  const linked = page.refinements.flatMap(mentions);
  expect(new Set(linked.map((term) => term.toLowerCase())).size).toBe(
    linked.length,
  );
});

test("runtime refinements read as sentences with field names as code", () => {
  expect(
    refinementSentence(
      "inlineRekeyCommitId must be present exactly when containerRekeys is non-empty",
    ),
  ).toBe(
    "`inlineRekeyCommitId` must be present exactly when `containerRekeys` is non-empty.",
  );
  expect(refinementSentence("outgoing update ids must be unique")).toBe(
    "Outgoing update ids must be unique.",
  );
  expect(refinementSentence("keep `fooBar` as written.")).toBe(
    "Keep `fooBar` as written.",
  );
});

test("unknown operation keys fail the build", () => {
  const document = JSON.parse(openApiText);
  document.paths["/"].get.deprecated = true;
  expect(() => parseApiDocument(JSON.stringify(document))).toThrow(
    /paths\.\/\.get: unsupported key "deprecated"/,
  );
  const secured = JSON.parse(openApiText);
  secured.paths["/"].get.security = [{ apiKey: [] }];
  expect(() => parseApiDocument(JSON.stringify(secured))).toThrow(
    /unsupported security requirement/,
  );
});
