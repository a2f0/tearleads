import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { resolveDocHref, technicalDocs } from "./technicalDocs";

const repositoryRoot = resolve(import.meta.dir, "../../..");

test("every published document exists with a unique slug", () => {
  for (const doc of technicalDocs) {
    expect(existsSync(resolve(repositoryRoot, doc.source))).toBe(true);
  }
  const slugs = technicalDocs.map((doc) => doc.slug);
  expect(new Set(slugs).size).toBe(slugs.length);
});

test("links to published documents stay on the site", () => {
  expect(
    resolveDocHref(
      "./keying-design.md#design-properties",
      "docs/cipher-suites.md",
    ),
  ).toBe("/docs/keying-design/#design-properties");
  expect(
    resolveDocHref("../docs/protocol-specification.md", "formal/README.md"),
  ).toBe("/docs/protocol-specification/");
  expect(resolveDocHref("../formal/README.md", "docs/keying-design.md")).toBe(
    "/docs/protocol-models/",
  );
});

test("other repository links go to GitHub", () => {
  expect(
    resolveDocHref(
      "../packages/crypto/src/challenge.ts#L3",
      "docs/cipher-suites.md",
    ),
  ).toBe(
    "https://github.com/a2f0/tearleads/blob/main/packages/crypto/src/challenge.ts#L3",
  );
  expect(resolveDocHref("../packages/api/", "docs/x.md")).toBe(
    "https://github.com/a2f0/tearleads/tree/main/packages/api",
  );
  expect(resolveDocHref("developer/scope.md", "docs/x.md")).toBe(
    "https://github.com/a2f0/tearleads/blob/main/docs/developer/scope.md",
  );
});

test("absolute URLs and fragments are kept", () => {
  for (const href of ["https://example.com/a", "mailto:a@b.c", "#section"]) {
    expect(resolveDocHref(href, "docs/x.md")).toBe(href);
  }
  expect(resolveDocHref("../../outside.md", "docs/x.md")).toBe(
    "../../outside.md",
  );
});
