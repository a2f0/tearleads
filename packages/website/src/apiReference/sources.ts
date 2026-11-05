import glossaryMarkdown from "../../../../docs/glossary.md?raw";
import openApiText from "../../../../docs/openapi.json?raw";
import { createApiReference } from "./referencePages";

/**
 * The API reference as the site builds it: docs/openapi.json (generated from
 * the Zod operation registry) and the glossary headings, read at build time
 * (packages/website/turbo.json declares both as inputs). The website reads
 * the document rather than importing @tearleads/validators.
 */
export const apiReference = createApiReference(openApiText, glossaryMarkdown);

/** The exact bytes of docs/openapi.json, served at /openapi.json. */
export const openApiBytes = new TextEncoder().encode(openApiText);
