import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type ApiOperation, parseApiDocument } from "./openApiDocument";
import {
  neighbours,
  operationPath,
  operationSlug,
  operationSlugs,
  schemaPath,
  schemaUsage,
  tagGroups,
} from "./referenceIndex";

const document = parseApiDocument(
  readFileSync(
    resolve(import.meta.dir, "../../../../docs/openapi.json"),
    "utf8",
  ),
);

function operation(operationId: string): ApiOperation {
  const found = document.operations.find(
    (candidate) => candidate.operationId === operationId,
  );
  if (found === undefined) throw new Error(`No operation ${operationId}`);
  return found;
}

test("operation slugs are readable and stable", () => {
  expect(operationSlug("containers.mutations.create")).toBe(
    "containers-mutations-create",
  );
  expect(operationSlug("containers.documentLanes.query")).toBe(
    "containers-document-lanes-query",
  );
  expect(operationPath(operation("organizations.create"))).toBe(
    "/docs/api/organizations-create/",
  );
  expect(operationPath(operation("auth.webSocketTicket"))).toBe(
    "/docs/api/auth-web-socket-ticket/",
  );
  expect(schemaPath("ErrorResponse")).toBe("/docs/api/schemas/ErrorResponse/");
});

test("every operation in the document has its own slug", () => {
  const slugs = operationSlugs(document.operations);
  expect(slugs.size).toBe(document.operations.length);
  expect(new Set(slugs.values()).size).toBe(document.operations.length);
});

test("two operations that would share a page slug fail the build", () => {
  const base = operation("health.get");
  expect(() =>
    operationSlugs([
      { ...base, operationId: "a.bC" },
      { ...base, operationId: "a.b.c" },
    ]),
  ).toThrow(/a\.bC and a\.b\.c share a-b-c/);
  expect(() => operationSlugs([{ ...base, operationId: "schemas" }])).toThrow(
    /unusable page slug/,
  );
});

test("tags keep document order, and neighbours stay within a tag", () => {
  const groups = tagGroups(document);
  expect(groups[0]?.tag.name).toBe("Health");
  expect(groups.map((group) => group.anchor)).toContain("root-operator");
  expect(
    groups.reduce((count, group) => count + group.operations.length, 0),
  ).toBe(document.operations.length);
  const first = groups[1]?.operations[0];
  if (first === undefined) throw new Error("No second tag");
  expect(neighbours(document, first).previous).toBeUndefined();
  expect(neighbours(document, first).next?.tag).toBe(first.tag);
});

test("schema usage lists direct operation and schema references", () => {
  const usage = schemaUsage(document);
  expect(usage.size).toBe(document.schemas.size);
  const request = usage.get("CreateOrganizationRequest");
  expect(request?.operations.map((user) => user.operationId)).toEqual([
    "organizations.create",
  ]);
  expect(usage.get("CreateOrganizationGroupRequest")?.schemas).toContain(
    "CreateOrganizationRequest",
  );
  expect(usage.get("ErrorResponse")?.operations.length).toBeGreaterThan(50);
});
