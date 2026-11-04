import GithubSlugger from "github-slugger";

/**
 * Descriptions in docs/openapi.json are plain text with optional backtick
 * code spans. They render as paragraphs of text, code, and glossary links.
 */

export type TextPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "term"; readonly text: string; readonly href: string };

export type Paragraph = readonly TextPart[];
export type RichText = readonly Paragraph[];

export interface GlossaryTerm {
  readonly term: string;
  readonly slug: string;
}

/** Turns plain text into the parts of one page, in reading order. */
export type TextRenderer = (text: string | undefined) => RichText;

/**
 * The glossary's terms: its `##` headings, with the anchors the published
 * page gives them (GitHub's slug rule, numbered in heading order like
 * docLinksPlugin). Headings inside fenced code are not headings.
 */
export function glossaryTerms(markdown: string): readonly GlossaryTerm[] {
  const slugger = new GithubSlugger();
  const terms: GlossaryTerm[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading === null) continue;
    const [, marks = "", text = ""] = heading;
    const slug = slugger.slug(text);
    if (marks.length === 2) terms.push({ term: text, slug });
  }
  return terms;
}

/** Paragraphs split on blank lines; single line breaks are spaces. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter((paragraph) => paragraph !== "");
}

function codeSpans(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const pattern = /`([^`]+)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) {
      parts.push({ kind: "text", text: text.slice(last, match.index) });
    }
    parts.push({ kind: "code", text: match[1] ?? "" });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One alternation, longest term first, matching whole words and plurals. */
function termPattern(terms: readonly GlossaryTerm[]): RegExp | null {
  if (terms.length === 0) return null;
  const alternatives = [...terms]
    .map((entry) => entry.term)
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join("|");
  return new RegExp(
    `(?<![\\p{L}\\p{N}_-])(${alternatives})(?:e?s)?(?![\\p{L}\\p{N}_-])`,
    "giu",
  );
}

/**
 * A renderer for one page. It links the first mention of each glossary term
 * on the page (case-insensitive, whole words, longest term first) to
 * /docs/glossary/#<slug>, and never inside code spans. Call it in the order
 * the page shows the text, so "first" means first on screen.
 */
export function createTextRenderer(
  terms: readonly GlossaryTerm[],
): TextRenderer {
  const pattern = termPattern(terms);
  const slugs = new Map(
    terms.map((entry) => [entry.term.toLowerCase(), entry.slug]),
  );
  const linked = new Set<string>();

  function linkTerms(text: string): TextPart[] {
    if (pattern === null) return [{ kind: "text", text }];
    const parts: TextPart[] = [];
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      const key = (match[1] ?? "").toLowerCase();
      const slug = slugs.get(key);
      if (slug === undefined || linked.has(key)) continue;
      linked.add(key);
      if (match.index > last) {
        parts.push({ kind: "text", text: text.slice(last, match.index) });
      }
      parts.push({
        kind: "term",
        text: match[0],
        href: `/docs/glossary/#${slug}`,
      });
      last = match.index + match[0].length;
    }
    if (last < text.length) {
      parts.push({ kind: "text", text: text.slice(last) });
    }
    return parts;
  }

  return (text) =>
    text === undefined
      ? []
      : paragraphs(text).map((paragraph) =>
          codeSpans(paragraph).flatMap((part) =>
            part.kind === "text" ? linkTerms(part.text) : [part],
          ),
        );
}
