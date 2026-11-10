/**
 * Dark screenshots (`<source media="(prefers-color-scheme: dark)">`) and the
 * browser-chrome color (`<meta name="theme-color" media>`) select on the OS
 * scheme, which the theme switch can override. This rewrites each such media
 * query for the scheme stamped on `<html data-theme-scheme>`, keeping the
 * original in `data-color-scheme-media`, and repeats whenever the stamp
 * changes. Without scripting the queries keep following the OS.
 */

type ColorScheme = "light" | "dark";

const ORIGINAL_ATTRIBUTE = "data-color-scheme-media";
const SCHEME_ATTRIBUTE = "data-theme-scheme";
const SCHEME_FEATURE = /^\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)$/i;

/**
 * `media` with each `(prefers-color-scheme: …)` feature decided for `scheme`:
 * a matching feature drops out of its query, and a query with a feature that
 * does not match drops out of the list. Handles queries joined by `and` and
 * lists joined by commas, the forms the site writes.
 */
export function mediaForColorScheme(
  media: string,
  scheme: ColorScheme,
): string {
  const queries: string[] = [];
  for (const query of media.split(",")) {
    const conditions = query.trim().split(/\s+and\s+/i);
    const kept: string[] = [];
    let matches = true;
    for (const condition of conditions) {
      const feature = SCHEME_FEATURE.exec(condition);
      if (!feature) {
        kept.push(condition);
      } else if (feature[1]?.toLowerCase() !== scheme) {
        matches = false;
      }
    }
    if (matches) {
      queries.push(kept.length > 0 ? kept.join(" and ") : "all");
    }
  }
  return queries.length > 0 ? queries.join(", ") : "not all";
}

function stampedScheme(root: HTMLElement): ColorScheme | null {
  const scheme = root.getAttribute(SCHEME_ATTRIBUTE);
  return scheme === "light" || scheme === "dark" ? scheme : null;
}

const SCHEME_MEDIA_SELECTOR = "source[media], meta[name='theme-color'][media]";

function rewriteMedia(element: Element, scheme: ColorScheme): void {
  const original =
    element.getAttribute(ORIGINAL_ATTRIBUTE) ??
    element.getAttribute("media") ??
    "";
  if (!/prefers-color-scheme/i.test(original)) {
    return;
  }
  element.setAttribute(ORIGINAL_ATTRIBUTE, original);
  element.setAttribute("media", mediaForColorScheme(original, scheme));
}

function rewriteWithin(root: Element, scheme: ColorScheme): void {
  if (root.matches(SCHEME_MEDIA_SELECTOR)) {
    rewriteMedia(root, scheme);
  }
  for (const element of root.querySelectorAll(SCHEME_MEDIA_SELECTOR)) {
    rewriteMedia(element, scheme);
  }
}

/**
 * Syncs now, after every change to `<html data-theme-scheme>`, and for
 * elements added later, such as the slides agent-tool's `screenshot-carousel`
 * renders from its manifest. Returns a function that stops following.
 */
export function followColorSchemeMedia(document: Document): () => void {
  const root = document.documentElement;
  const scheme = stampedScheme(root);
  if (scheme) {
    rewriteWithin(root, scheme);
  }
  const observer = new MutationObserver((records) => {
    const current = stampedScheme(root);
    if (!current) {
      return;
    }
    for (const record of records) {
      if (record.type === "attributes") {
        rewriteWithin(root, current);
        continue;
      }
      for (const node of record.addedNodes) {
        if (node instanceof Element) {
          rewriteWithin(node, current);
        }
      }
    }
  });
  observer.observe(root, {
    attributeFilter: [SCHEME_ATTRIBUTE],
    childList: true,
    subtree: true,
  });
  return () => observer.disconnect();
}
