import { expect, test } from "bun:test";
import { createDomainScope } from "../../data/domainScope";
import {
  clearOriginatedDocuments,
  consumeOriginatedDocument,
  markOriginatedDocuments,
} from "./originatedDocuments";

test("consumes a marked origination exactly once", () => {
  const scope = createDomainScope();
  markOriginatedDocuments(scope, ["doc-1"]);

  expect(consumeOriginatedDocument(scope, "doc-1")).toBe(true);
  // Single-use: a genuine later remote change to the same doc is not suppressed.
  expect(consumeOriginatedDocument(scope, "doc-1")).toBe(false);
});

test("returns false for ids that were never originated", () => {
  const scope = createDomainScope();
  markOriginatedDocuments(scope, ["doc-1"]);

  expect(consumeOriginatedDocument(scope, "doc-2")).toBe(false);
});

test("origination is isolated per domain scope", () => {
  const scopeA = createDomainScope();
  const scopeB = createDomainScope();
  markOriginatedDocuments(scopeA, ["doc-1"]);

  expect(consumeOriginatedDocument(scopeB, "doc-1")).toBe(false);
  expect(consumeOriginatedDocument(scopeA, "doc-1")).toBe(true);
});

test("ignores empty ids", () => {
  const scope = createDomainScope();
  markOriginatedDocuments(scope, ["", "doc-1"]);

  expect(consumeOriginatedDocument(scope, "")).toBe(false);
  expect(consumeOriginatedDocument(scope, "doc-1")).toBe(true);
});

test("clear drops pending originations", () => {
  const scope = createDomainScope();
  markOriginatedDocuments(scope, ["doc-1", "doc-2"]);
  clearOriginatedDocuments(scope);

  expect(consumeOriginatedDocument(scope, "doc-1")).toBe(false);
  expect(consumeOriginatedDocument(scope, "doc-2")).toBe(false);
});
