/**
 * Search and social metadata shared by the layout and the build integration.
 *
 * Only an indexable page names a URL: staging pages and drafts carry a robots
 * tag instead of a canonical link or `og:url`, and the sitemap lists exactly
 * the built pages' canonical links.
 */
export const siteName = "Tearleads";
export const siteOrigin = "https://tearleads.com";

/** Rendered from assets/brand by the agent-tool `website` image target. */
export const socialImage = {
  url: `${siteOrigin}/og-image.png`,
  width: 1200,
  height: 630,
  alt: "The Tearleads logo",
} as const;

/** The robots meta value for a page, or null for an indexable page. */
export function robotsDirective(input: {
  readonly isStaging: boolean;
  readonly noIndex: boolean;
}): string | null {
  if (input.isStaging) return "noindex, nofollow";
  return input.noIndex ? "noindex" : null;
}

/**
 * The absolute production URL of an indexable page. Pages are built as
 * `<path>/index.html`, and Workers Static Assets' auto-trailing-slash handling
 * redirects `/pricing` to `/pricing/`, so every path but the root ends in a
 * slash.
 */
export function canonicalUrl(pathname: string): string {
  const trimmed = pathname.replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? `${siteOrigin}/` : `${siteOrigin}/${trimmed}/`;
}

/**
 * Only production advertises a sitemap. Staging relies on its noindex header
 * and meta instead of `Disallow`, which would hide them from crawlers.
 */
export function robotsTxt(isProduction: boolean): string {
  const rules = "User-agent: *\nAllow: /\n";
  return isProduction
    ? `${rules}\nSitemap: ${siteOrigin}/sitemap.xml\n`
    : rules;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function sitemapXml(urls: readonly string[]): string {
  const entries = urls
    .map((url) => `  <url><loc>${escapeXml(url)}</loc></url>\n`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}</urlset>\n`;
}

export const stagingRobotsHeader = "X-Robots-Tag: noindex, nofollow";

/**
 * Adds the staging noindex header to every response, not just HTML. Workers
 * Static Assets keys `_headers` rules by path, so a second `/*` block would
 * replace the first one's headers; the header joins the existing block.
 */
export function withStagingNoindex(headers: string): string {
  const lines = headers.split("\n");
  const everyPath = lines.findIndex((line) => line.trim() === "/*");
  if (everyPath === -1) {
    return `${headers.replace(/\n*$/, "\n")}/*\n  ${stagingRobotsHeader}\n`;
  }
  lines.splice(everyPath + 1, 0, `  ${stagingRobotsHeader}`);
  return lines.join("\n");
}

/**
 * Serializes JSON-LD for an inline script. Escaping `<` keeps a value such as
 * `</script>` from ending the element early.
 */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}
