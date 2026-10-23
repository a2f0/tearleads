// Adds the deployment tier's search tags to dist/index.html. Every route of
// the app and demo hosts serves this one document. Production names the app
// root as its canonical URL, so the demo hosts' copy and every route
// consolidate there. Staging names no URL and asks not to be indexed; the
// deploy's `_headers` sends the matching X-Robots-Tag with every response.
// Local builds get neither.
export const PRODUCTION_URL_TAGS =
  '<link rel="canonical" href="https://app.tearleads.com/" />' +
  '<meta property="og:url" content="https://app.tearleads.com/" />';
export const STAGING_ROBOTS_META =
  '<meta name="robots" content="noindex, nofollow" />';

const TIER_TAG =
  /<link\s+rel="canonical"[^>]*>|<meta\s+(?:name="robots"|property="og:url")[^>]*>/i;

function tierTags(tier: string | undefined): string {
  switch (tier) {
    case "prod":
      return PRODUCTION_URL_TAGS;
    case "staging":
      return STAGING_ROBOTS_META;
    case undefined:
    case "":
      return "";
    default:
      throw new Error(`APP_WEB_TIER must be prod or staging, not ${tier}`);
  }
}

export function injectTierMeta(html: string, tier: string | undefined) {
  const tags = tierTags(tier);
  if (tags !== "" && html.includes(tags)) return html;
  const existing = html.match(TIER_TAG)?.[0];
  if (existing) throw new Error(`Unexpected tier tag: ${existing}`);
  if (tags === "") return html;
  const out = html.replace(/<\/head>/i, `${tags}</head>`);
  if (out === html) throw new Error("No </head> found in index.html");
  return out;
}

if (import.meta.main) {
  const indexHtml = Bun.file(new URL("../dist/index.html", import.meta.url));
  if (!(await indexHtml.exists())) {
    throw new Error("dist/index.html not found; run the bundle build first.");
  }
  const { APP_WEB_TIER: tier } = process.env;
  await Bun.write(indexHtml, injectTierMeta(await indexHtml.text(), tier));
  console.log(`Added the ${tier || "local"} tier tags to dist/index.html`);
}
