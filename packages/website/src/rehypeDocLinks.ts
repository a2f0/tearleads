import { rmSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { resolveDocHref } from "./technicalDocs";

/**
 * Rehype plugin for Markdown rendered from the repository (the `docs`
 * collection): rewrites each relative link to the published page or GitHub
 * file it names (see `resolveDocHref`), and wraps tables in a labelled scroll
 * region so a wide table scrolls instead of widening the page. The leading h1
 * is dropped: the page header renders the document's title (technicalDocs.ts).
 * Markdown inside the website package is left alone.
 */

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

interface HastFile {
  path?: string;
  history?: string[];
}

const repositoryRoot = resolve(
  fileURLToPath(new URL("../../..", import.meta.url)),
);
const websiteRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

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

export function rehypeDocLinks() {
  return (tree: HastNode, file: HastFile) => {
    const path = file.path ?? file.history?.[0];
    if (path === undefined) return;
    const absolute = resolve(path);
    if (absolute.startsWith(websiteRoot + sep)) return;
    const source = relative(repositoryRoot, absolute).split(sep).join("/");
    if (source.startsWith("..")) return;
    dropTitle(tree);
    transform(tree, source);
  };
}

function dropTitle(tree: HastNode) {
  const children = tree.children ?? [];
  const index = children.findIndex(
    (child) => child.type === "element" && child.tagName === "h1",
  );
  if (index !== -1) children.splice(index, 1);
}

function transform(node: HastNode, source: string) {
  const children = node.children ?? [];
  for (const [index, child] of children.entries()) {
    if (child.type !== "element") continue;
    if (child.tagName === "a" && typeof child.properties?.href === "string") {
      child.properties.href = resolveDocHref(child.properties.href, source);
    }
    if (child.tagName === "table") {
      children[index] = {
        type: "element",
        tagName: "div",
        properties: {
          className: ["docs-table"],
          role: "region",
          tabIndex: 0,
          ariaLabel: "Table (scrolls horizontally)",
        },
        children: [child],
      };
    }
    transform(child, source);
  }
}
