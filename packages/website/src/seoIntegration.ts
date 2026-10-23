import { readFile, writeFile } from "node:fs/promises";
import type { AstroIntegration } from "astro";
import { robotsTxt, sitemapXml, withStagingNoindex } from "./seo";

const canonicalLink = /<link\s+rel="canonical"\s+href="([^"]+)"/i;
// Astro writes error pages to 404.html and 500.html; they are never listed.
const errorRoutes = new Set(["404", "500"]);

/** The canonical links of the built pages; pages without one are left out. */
async function canonicalPageUrls(
  dir: URL,
  pathnames: readonly string[],
): Promise<string[]> {
  const urls = new Set<string>();
  for (const pathname of pathnames) {
    const path = pathname.replace(/^\/+|\/+$/g, "");
    // A file route, such as an endpoint, is not an HTML page.
    if (errorRoutes.has(path) || /\.[a-z0-9]+$/i.test(path)) continue;
    const html = await readFile(
      new URL(path === "" ? "index.html" : `${path}/index.html`, dir),
      "utf8",
    );
    const canonical = html.match(canonicalLink)?.[1];
    if (canonical) urls.add(canonical);
  }
  return [...urls].sort();
}

/**
 * Writes the crawler files for the build's PUBLIC_ENVIRONMENT: robots.txt on
 * every build, sitemap.xml on production only, and on staging a `_headers`
 * rule that sends X-Robots-Tag with every asset.
 */
export function seoIntegration(
  environment: string | undefined,
): AstroIntegration {
  // Deployments name their tier; a local build leaves it unset. Any other
  // value would publish indexable pages without a sitemap, so it fails.
  if (environment && environment !== "production" && environment !== "staging")
    throw new Error(
      `PUBLIC_ENVIRONMENT must be production or staging, not ${environment}`,
    );
  const isProduction = environment === "production";
  return {
    name: "tearleads-seo",
    hooks: {
      "astro:build:done": async ({ dir, pages }) => {
        await writeFile(new URL("robots.txt", dir), robotsTxt(isProduction));
        if (isProduction) {
          const urls = await canonicalPageUrls(
            dir,
            pages.map((page) => page.pathname),
          );
          await writeFile(new URL("sitemap.xml", dir), sitemapXml(urls));
        }
        if (environment === "staging") {
          const headers = new URL("_headers", dir);
          await writeFile(
            headers,
            withStagingNoindex(await readFile(headers, "utf8")),
          );
        }
      },
    },
  };
}
