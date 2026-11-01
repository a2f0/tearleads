import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  docsDiagramThemeStyle,
  inlineDocsDiagram,
  siteDocsDiagramTheme,
} from "./docsDiagram";

const repoRoot = resolve(import.meta.dir, "../../..");
const accessKeyingPath = resolve(
  repoRoot,
  "docs/diagrams/access-and-keying.svg",
);
const infrastructurePath = resolve(
  repoRoot,
  "docs/diagrams/infrastructure.svg",
);
/** Every diagram the website inlines. */
const diagramPaths = [accessKeyingPath, infrastructurePath];
const stylesheetPath = resolve(import.meta.dir, "styles/docsDiagram.css");

function usedClasses(svg: string): Set<string> {
  const classes = new Set<string>();
  for (const match of svg.matchAll(/\sclass="([^"]+)"/g)) {
    for (const name of (match[1] ?? "").split(/\s+/)) classes.add(name);
  }
  return classes;
}

/** Font size per class from rules whose selectors list the classes. */
function fontSizes(source: string, rule: RegExp): Record<string, number> {
  const sizes: Record<string, number> = {};
  for (const [, selector = "", body = ""] of source.matchAll(rule)) {
    const size = body.match(/font-size: ([\d.]+)px/)?.[1];
    if (size === undefined) continue;
    for (const [, name = ""] of selector.matchAll(/\.([a-z-]+)/g)) {
      if (name !== "docs-diagram") sizes[name] = Number(size);
    }
  }
  return sizes;
}

describe("inlineDocsDiagram", () => {
  test("strips the standalone style and size from the access diagram", async () => {
    const markup = inlineDocsDiagram(await Bun.file(accessKeyingPath).text());
    expect(markup).not.toContain("<style");
    expect(markup).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    const root = markup.match(/<svg\b[^>]*>/)?.[0] ?? "";
    expect(root).toContain('viewBox="0 0 1000 1256"');
    expect(root).toContain('class="docs-diagram-svg"');
    expect(root).toContain('role="img"');
    expect(root).not.toMatch(/\s(?:width|height|font-family)=/);
    expect(markup).toContain(
      "<title>Tearleads access lookup and keying</title>",
    );
    expect(markup).toContain('marker-end="url(#access-keying-arrow)"');
    expect(markup).toContain('id="access-keying-arrow"');
  });

  test("strips the standalone style and size from the infrastructure diagram", async () => {
    const markup = inlineDocsDiagram(await Bun.file(infrastructurePath).text());
    expect(markup).not.toContain("<style");
    expect(markup).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    const root = markup.match(/<svg\b[^>]*>/)?.[0] ?? "";
    expect(root).toContain('viewBox="0 0 1000 1000"');
    expect(markup).toContain("<title>Tearleads infrastructure</title>");
    expect(markup).toContain('marker-end="url(#infrastructure-arrow)"');
    expect(markup).toContain('id="infrastructure-arrow"');
  });

  test("rejects colors set by attribute, which the theme cannot reach", () => {
    expect(() =>
      inlineDocsDiagram(
        '<svg viewBox="0 0 1 1"><title>t</title><rect fill="#fff"/></svg>',
      ),
    ).toThrow("through classes");
    expect(() =>
      inlineDocsDiagram(
        '<svg viewBox="0 0 1 1"><title>t</title><path style="stroke:#000"/></svg>',
      ),
    ).toThrow("through classes");
  });

  test("requires a title and a viewBox", () => {
    expect(() => inlineDocsDiagram('<svg viewBox="0 0 1 1"></svg>')).toThrow(
      "<title>",
    );
    expect(() =>
      inlineDocsDiagram('<svg width="1"><title>t</title></svg>'),
    ).toThrow("viewBox");
  });
});

describe("docsDiagram.css", () => {
  test("styles every class each diagram uses", async () => {
    const css = await Bun.file(stylesheetPath).text();
    for (const path of diagramPaths) {
      const svg = await Bun.file(path).text();
      const unstyled = [...usedClasses(inlineDocsDiagram(svg))].filter(
        (name) =>
          name !== "docs-diagram-svg" &&
          !new RegExp(`\\.docs-diagram \\.${name}\\b(?!-)`).test(css),
      );
      expect({ path, unstyled }).toEqual({ path, unstyled: [] });
    }
  });

  test("matches the diagrams' own font sizes, which position their text", async () => {
    const css = await Bun.file(stylesheetPath).text();
    const siteSizes = fontSizes(
      css,
      /((?:\.docs-diagram \.[a-z-]+,?\s*)+)\{([^}]*)\}/g,
    );
    const allSourceSizes: Record<string, number> = {};
    for (const path of diagramPaths) {
      const svg = await Bun.file(path).text();
      const sourceSizes = fontSizes(svg, /(\.[a-z-]+) \{([^}]*)\}/g);
      expect(Object.keys(sourceSizes).length).toBeGreaterThan(5);
      for (const [name, size] of Object.entries(sourceSizes)) {
        expect({ path, name, size }).toEqual({
          path,
          name,
          size: siteSizes[name] ?? Number.NaN,
        });
        allSourceSizes[name] = size;
      }
    }
    // No stale size rule outlives the diagrams that used it.
    expect(siteSizes).toEqual(allSourceSizes);
  });

  test("keeps every diagram's smallest label at the site's 13px text floor", async () => {
    const css = await Bun.file(stylesheetPath).text();
    const minWidthRem = Number(
      css.match(/\.docs-diagram-svg \{[^}]*min-width: ([\d.]+)rem/)?.[1],
    );
    for (const path of diagramPaths) {
      const svg = await Bun.file(path).text();
      const viewBoxWidth = Number(svg.match(/viewBox="0 0 (\d+)/)?.[1]);
      const smallest = Math.min(
        ...Object.values(fontSizes(svg, /(\.[a-z-]+) \{([^}]*)\}/g)),
      );
      expect(Number.isFinite(smallest * minWidthRem * viewBoxWidth)).toBe(true);
      expect(
        (smallest * minWidthRem * 16) / viewBoxWidth,
      ).toBeGreaterThanOrEqual(13);
    }
  });

  test("reads only the properties the theme sets", async () => {
    const css = await Bun.file(stylesheetPath).text();
    const read = new Set(
      [...css.matchAll(/var\((--docs-diagram-[a-z-]+)\)/g)].map((m) => m[1]),
    );
    const set = new Set(
      docsDiagramThemeStyle()
        .split("; ")
        .map((declaration) => declaration.split(":")[0]),
    );
    expect([...read].sort()).toEqual([...set].sort());
  });
});

describe("docsDiagramThemeStyle", () => {
  test("defaults every role to a site token", () => {
    for (const value of Object.values(siteDocsDiagramTheme)) {
      expect(value).toMatch(/^var\(--site-[a-z0-9-]+\)$/);
    }
    const style = docsDiagramThemeStyle();
    expect(style.split("; ")).toHaveLength(
      Object.keys(siteDocsDiagramTheme).length,
    );
    expect(style).toContain("--docs-diagram-step: var(--site-ink)");
    expect(style).toContain("--docs-diagram-ink-muted: var(--site-ink-2)");
  });

  test("applies overrides and rejects values that escape the declaration", () => {
    expect(docsDiagramThemeStyle({ step: "var(--site-accent)" })).toContain(
      "--docs-diagram-step: var(--site-accent)",
    );
    expect(() =>
      docsDiagramThemeStyle({ ink: "red; background: url(x)" }),
    ).toThrow("ink");
  });
});
