import { rmSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import GithubSlugger from "github-slugger";
import { resolveDocHref } from "./technicalDocs";

/**
 * Sätteri hast plugin for Markdown rendered from the repository (the `docs`
 * collection). It
 *
 * - gives every heading GitHub's id (github-slugger over the heading text), so
 *   a fragment that works on GitHub works on the site;
 * - replaces the document's h1 with an empty anchor carrying its id, since the
 *   page header renders the title (technicalDocs.ts);
 * - rewrites each relative link to the published page or GitHub file it names
 *   (`resolveDocHref`); and
 * - wraps tables in a labelled region that scrolls instead of widening the page.
 *
 * Astro's own heading-id pass runs after this one and keeps existing ids.
 * Markdown inside the website package is left alone.
 */

interface Element {
  readonly type: "element";
  readonly tagName: string;
  readonly properties?: Record<string, unknown>;
  readonly children?: readonly unknown[];
}

interface VisitorContext {
  textContent(node: Readonly<Element>): string;
  setProperty(node: Readonly<Element>, key: string, value: unknown): void;
  replaceNode(node: Readonly<Element>, replacement: Element): void;
  wrapNode(node: Readonly<Element>, parent: Element): void;
}

const repositoryRoot = resolve(
  fileURLToPath(new URL("../../..", import.meta.url)),
);
const websiteRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const headingTags = ["h1", "h2", "h3", "h4", "h5", "h6"];

/** The repository-relative source path, or null outside the published docs. */
function repositorySource(fileURL: URL | undefined): string | null {
  if (fileURL === undefined || fileURL.protocol !== "file:") return null;
  const absolute = fileURLToPath(fileURL);
  if (absolute.startsWith(websiteRoot + sep)) return null;
  const source = relative(repositoryRoot, absolute).split(sep).join("/");
  return source.startsWith("..") ? null : source;
}

/** A plugin factory: Sätteri calls it once per document. */
export function docLinksPlugin({
  fileURL,
}: {
  readonly fileURL: URL | undefined;
}) {
  const source = repositorySource(fileURL);
  if (source === null) return null;
  const slugger = new GithubSlugger();
  let titleReplaced = false;
  return {
    name: "doc-links",
    element: {
      filter: [...headingTags, "a", "table"],
      visit(node: Readonly<Element>, ctx: VisitorContext) {
        if (headingTags.includes(node.tagName)) {
          const existing = node.properties?.id;
          const id =
            typeof existing === "string"
              ? existing
              : slugger.slug(ctx.textContent(node));
          if (node.tagName === "h1" && !titleReplaced) {
            titleReplaced = true;
            ctx.replaceNode(node, {
              type: "element",
              tagName: "span",
              properties: { id },
              children: [],
            });
          } else if (typeof existing !== "string") {
            ctx.setProperty(node, "id", id);
          }
        } else if (node.tagName === "a") {
          const href = node.properties?.href;
          if (typeof href === "string") {
            ctx.setProperty(node, "href", resolveDocHref(href, source));
          }
        } else {
          ctx.wrapNode(node, {
            type: "element",
            tagName: "div",
            properties: {
              className: ["docs-table"],
              role: "region",
              tabIndex: 0,
              ariaLabel: "Table (scrolls horizontally)",
            },
            children: [],
          });
        }
      },
    },
  };
}

/**
 * Astro caches rendered content entries by source digest, so a change to this
 * plugin or to `technicalDocs` (which decides where links point) would leave
 * stale HTML. The collection is a few documents; drop the cache every build.
 */
export function freshDocsCache(): AstroIntegration {
  return {
    name: "fresh-docs-cache",
    hooks: {
      "astro:config:setup": ({ config }) => {
        rmSync(new URL("data-store.json", config.cacheDir), { force: true });
      },
    },
  };
}
