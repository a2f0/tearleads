import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { docPath, technicalDocPages } from "../technicalDocs";
import { createTextRenderer, glossaryTerms } from "./richText";

const glossary = technicalDocPages
  .filter((doc) => doc.parent === "glossary")
  .map((doc) => ({
    path: docPath(doc),
    markdown: readFileSync(
      resolve(import.meta.dir, "../../../..", doc.source),
      "utf8",
    ),
  }));

const terms = [
  { term: "Blob", href: "/docs/glossary/content/#blob" },
  {
    term: "Blob Content-Key Bundle",
    href: "/docs/glossary/keys/#blob-content-key-bundle",
  },
  {
    term: "Content-Key Bundle",
    href: "/docs/glossary/keys/#content-key-bundle",
  },
  { term: "Head", href: "/docs/glossary/sync/#head" },
];

test("glossary terms are its topic pages' h2 headings with GitHub anchors", () => {
  const parsed = glossaryTerms(glossary);
  expect(parsed.length).toBeGreaterThan(20);
  expect(parsed).toContainEqual({
    term: "Content-Key Bundle",
    href: "/docs/glossary/keys/#content-key-bundle",
  });
  expect(parsed).toContainEqual({
    term: "Container KEK",
    href: "/docs/glossary/keys/#container-kek",
  });
  expect(parsed.some((entry) => entry.term.startsWith("Glossary"))).toBe(false);
  // Repeated headings number like GitHub; fenced headings are ignored.
  expect(
    glossaryTerms([
      {
        path: "/g/",
        markdown: "# T\n\n## Head\n\n```\n## Fake\n```\n\n## Head\n",
      },
    ]),
  ).toEqual([
    { term: "Head", href: "/g/#head" },
    { term: "Head", href: "/g/#head-1" },
  ]);
});

test("paragraphs split on blank lines and code spans render as code", () => {
  const render = createTextRenderer([]);
  expect(render("Send `x-tearleads-blob-id`\nwith it.\n\nThen wait.")).toEqual([
    [
      { kind: "text", text: "Send " },
      { kind: "code", text: "x-tearleads-blob-id" },
      { kind: "text", text: " with it." },
    ],
    [{ kind: "text", text: "Then wait." }],
  ]);
  expect(render(undefined)).toEqual([]);
});

test("the first mention of each term per page links, longest term first", () => {
  const render = createTextRenderer(terms);
  expect(render("A blob content-key bundle wraps the blob key.")).toEqual([
    [
      { kind: "text", text: "A " },
      {
        kind: "term",
        text: "blob content-key bundle",
        href: "/docs/glossary/keys/#blob-content-key-bundle",
      },
      { kind: "text", text: " wraps the " },
      { kind: "term", text: "blob", href: "/docs/glossary/content/#blob" },
      { kind: "text", text: " key." },
    ],
  ]);
  // Later text on the same page leaves linked terms alone.
  expect(render("Blobs and content-key bundles.")).toEqual([
    [
      { kind: "text", text: "Blobs and " },
      {
        kind: "term",
        text: "content-key bundles",
        href: "/docs/glossary/keys/#content-key-bundle",
      },
      { kind: "text", text: "." },
    ],
  ]);
  // A fresh renderer is a fresh page.
  expect(createTextRenderer(terms)("Heads")[0]?.[0]).toMatchObject({
    kind: "term",
    text: "Heads",
  });
});

test("terms match whole words only and never inside code", () => {
  const render = createTextRenderer(terms);
  expect(render("Headers name a `head` and a blobId.")).toEqual([
    [
      { kind: "text", text: "Headers name a " },
      { kind: "code", text: "head" },
      { kind: "text", text: " and a blobId." },
    ],
  ]);
  expect(render("x-head and head-1 are not mentions; head is.")).toEqual([
    [
      { kind: "text", text: "x-head and head-1 are not mentions; " },
      { kind: "term", text: "head", href: "/docs/glossary/sync/#head" },
      { kind: "text", text: " is." },
    ],
  ]);
});
