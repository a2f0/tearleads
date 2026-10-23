import { expect, test } from "bun:test";
import {
  canonicalUrl,
  jsonLd,
  robotsDirective,
  robotsTxt,
  sitemapXml,
  withStagingNoindex,
} from "./seo";
import { availablePlatforms, homeStructuredData } from "./structuredData";

test("canonical URLs use the production origin and trailing-slash form", () => {
  expect(canonicalUrl("/")).toBe("https://tearleads.com/");
  expect(canonicalUrl("")).toBe("https://tearleads.com/");
  expect(canonicalUrl("/pricing")).toBe("https://tearleads.com/pricing/");
  expect(canonicalUrl("/features/sharing/")).toBe(
    "https://tearleads.com/features/sharing/",
  );
});

test("staging pages are noindex, nofollow; drafts are noindex", () => {
  expect(robotsDirective({ isStaging: true, noIndex: false })).toBe(
    "noindex, nofollow",
  );
  expect(robotsDirective({ isStaging: true, noIndex: true })).toBe(
    "noindex, nofollow",
  );
  expect(robotsDirective({ isStaging: false, noIndex: true })).toBe("noindex");
  expect(robotsDirective({ isStaging: false, noIndex: false })).toBeNull();
});

test("only production robots.txt advertises the sitemap", () => {
  expect(robotsTxt(true)).toBe(
    "User-agent: *\nAllow: /\n\nSitemap: https://tearleads.com/sitemap.xml\n",
  );
  expect(robotsTxt(false)).toBe("User-agent: *\nAllow: /\n");
  expect(robotsTxt(false)).not.toContain("Disallow");
});

test("sitemaps escape their locations", () => {
  expect(sitemapXml(["https://tearleads.com/a&b/"])).toBe(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://tearleads.com/a&amp;b/</loc></url>\n</urlset>\n',
  );
});

test("JSON-LD cannot close its script element", () => {
  const serialized = jsonLd({ name: "</script><script>alert(1)</script>" });
  expect(serialized).not.toContain("<");
  expect(JSON.parse(serialized)).toEqual({
    name: "</script><script>alert(1)</script>",
  });
});

test("the home graph claims only what the site states", () => {
  interface GraphNode {
    readonly "@type": string;
    readonly operatingSystem?: string;
    readonly offers?: unknown;
  }
  const graph: { "@graph": GraphNode[] } = JSON.parse(
    jsonLd(homeStructuredData("Description.")),
  );
  const nodes = graph["@graph"];
  expect(nodes.map((node) => node["@type"])).toEqual([
    "Organization",
    "WebSite",
    "SoftwareApplication",
  ]);
  const app = nodes[2];
  expect(app?.operatingSystem).toBe(availablePlatforms.join(", "));
  // The native apps are not yet published to the stores.
  expect(app?.operatingSystem).not.toMatch(/iOS|Android/);
  expect(app?.offers).toEqual({
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  });
  for (const node of nodes) {
    expect(node).not.toHaveProperty("aggregateRating");
    expect(node).not.toHaveProperty("review");
  }
});

test("the staging header joins the existing every-path rule", () => {
  expect(
    withStagingNoindex("/*\n  Cache-Control: no-cache\n\n/a/*\n  B: c\n"),
  ).toBe(
    "/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-cache\n\n/a/*\n  B: c\n",
  );
  expect(withStagingNoindex("/a/*\n  B: c")).toBe(
    "/a/*\n  B: c\n/*\n  X-Robots-Tag: noindex, nofollow\n",
  );
});
