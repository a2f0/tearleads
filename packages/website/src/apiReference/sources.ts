import accessGlossary from "../../../../docs/glossary/access.md?raw";
import contentGlossary from "../../../../docs/glossary/content.md?raw";
import keysGlossary from "../../../../docs/glossary/keys.md?raw";
import principalsGlossary from "../../../../docs/glossary/principals.md?raw";
import syncGlossary from "../../../../docs/glossary/sync.md?raw";
import openApiText from "../../../../docs/openapi.json?raw";
import { docForSlug, docPath } from "../technicalDocs";
import { createApiReference } from "./referencePages";

/**
 * The API reference as the site builds it: docs/openapi.json (generated from
 * the Zod operation registry) and the headings of the glossary's topic pages,
 * read at build time (packages/website/turbo.json declares both as inputs).
 * The website reads the document rather than importing @tearleads/validators.
 */
export const apiReference = createApiReference(openApiText, [
  { path: docPath(docForSlug("glossary/access")), markdown: accessGlossary },
  { path: docPath(docForSlug("glossary/keys")), markdown: keysGlossary },
  { path: docPath(docForSlug("glossary/content")), markdown: contentGlossary },
  {
    path: docPath(docForSlug("glossary/principals")),
    markdown: principalsGlossary,
  },
  { path: docPath(docForSlug("glossary/sync")), markdown: syncGlossary },
]);

/** The exact bytes of docs/openapi.json, served at /openapi.json. */
export const openApiBytes = new TextEncoder().encode(openApiText);
