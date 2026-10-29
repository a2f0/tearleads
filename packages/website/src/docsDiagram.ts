/**
 * Inline SVG diagrams from docs/diagrams, restyled for the website.
 *
 * A docs diagram carries its own <style> block so it renders standalone on
 * GitHub. Inline in a page that block would leak its class rules into the
 * whole document, so it is stripped and DocsDiagram.astro supplies the rules
 * from docsDiagram.css instead, reading colors from a DocsDiagramTheme.
 *
 * Diagrams must color every element through a class (see the class list in
 * docsDiagram.css), never a fill, stroke, or style attribute: otherwise the
 * theme could not reach it in dark mode.
 */

/** Color and type roles used by the docs diagram class vocabulary. */
export interface DocsDiagramTheme {
  /** Diagram background and the plain lane bands. */
  readonly canvas: string;
  /** Alternate lane bands. */
  readonly band: string;
  /** Lane and column separators. */
  readonly rule: string;
  /** Box fill. */
  readonly surface: string;
  /** Titles, names, and headings. */
  readonly ink: string;
  /** Secondary text: subtitles, metadata, edge labels. */
  readonly inkMuted: string;
  /** Tertiary text: lane subtitles. */
  readonly inkSubtle: string;
  /** Lookup boxes, edges, and arrowheads. */
  readonly edge: string;
  /** Key boxes, key edges, and their arrowheads (drawn dashed). */
  readonly keyEdge: string;
  /** Key labels and key edge labels. */
  readonly keyInk: string;
  /** Step badge fill. */
  readonly step: string;
  /** Step badge number. */
  readonly stepInk: string;
  readonly fontSans: string;
  readonly fontMono: string;
}

/**
 * The site's grayscale palette. Every role reads a tokens.css variable, so
 * the diagram follows prefers-color-scheme and print like the rest of the
 * site. Lookup and key paths differ by line style and weight, not hue.
 */
export const siteDocsDiagramTheme: DocsDiagramTheme = {
  canvas: "var(--site-surface)",
  band: "var(--site-bg)",
  rule: "var(--site-line)",
  surface: "var(--site-surface)",
  ink: "var(--site-ink)",
  inkMuted: "var(--site-ink-2)",
  inkSubtle: "var(--site-ink-3)",
  edge: "var(--site-ink-2)",
  keyEdge: "var(--site-line-strong)",
  keyInk: "var(--site-ink)",
  step: "var(--site-ink)",
  stepInk: "var(--site-surface)",
  fontSans: "var(--site-font-sans)",
  fontMono: "var(--site-font-mono)",
};

/** Every role, in declaration order; docsDiagram.test.ts checks coverage. */
const themeRoles: readonly (keyof DocsDiagramTheme)[] = [
  "canvas",
  "band",
  "rule",
  "surface",
  "ink",
  "inkMuted",
  "inkSubtle",
  "edge",
  "keyEdge",
  "keyInk",
  "step",
  "stepInk",
  "fontSans",
  "fontMono",
];

/** The custom property for a role: inkMuted is --docs-diagram-ink-muted. */
function themeProperty(role: keyof DocsDiagramTheme): string {
  return `--docs-diagram-${role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** Custom-property declarations for a theme, for an element style attribute. */
export function docsDiagramThemeStyle(
  overrides: Partial<DocsDiagramTheme> = {},
): string {
  const theme = { ...siteDocsDiagramTheme, ...overrides };
  return themeRoles
    .map((role) => {
      const value = theme[role];
      if (/[;{}<>]/.test(value)) {
        throw new Error(`Invalid docs diagram theme value for ${role}`);
      }
      return `${themeProperty(role)}: ${value}`;
    })
    .join("; ");
}

const inlineColor = /\s(?:fill|stroke|style)="[^"]*#/;

/**
 * Prepares a docs diagram for inline use: drops its standalone <style> block
 * and fixed size (CSS sizes it from the viewBox) and marks it as an image
 * named by its <title>.
 */
export function inlineDocsDiagram(svg: string): string {
  const body = svg
    .replace(/<\?xml[^>]*>\s*/, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>\s*/g, "");
  if (inlineColor.test(body)) {
    throw new Error(
      "Docs diagrams must color elements through classes, not attributes",
    );
  }
  if (!/<title>[^<]+<\/title>/.test(body)) {
    throw new Error("Docs diagrams need a <title> for their accessible name");
  }
  return body.replace(/<svg\b[^>]*>/, (root) => {
    if (!/\sviewBox="/.test(root)) {
      throw new Error("Docs diagrams need a viewBox to scale");
    }
    return root
      .replace(/\s(?:width|height|font-family)="[^"]*"/g, "")
      .replace(
        /^<svg/,
        '<svg class="docs-diagram-svg" role="img" focusable="false"',
      );
  });
}
