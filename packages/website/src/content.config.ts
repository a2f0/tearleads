import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { docForSource, technicalDocs } from "./technicalDocs";

/**
 * The published technical documents, read from the repository root at build
 * time (packages/website/turbo.json declares them as build inputs).
 */
const docs = defineCollection({
  loader: glob({
    base: "../..",
    pattern: technicalDocs.map((doc) => doc.source),
    generateId: ({ entry }) => {
      const doc = docForSource(entry);
      if (doc === undefined) throw new Error(`Unpublished document ${entry}`);
      return doc.slug;
    },
  }),
});

export const collections = { docs };
