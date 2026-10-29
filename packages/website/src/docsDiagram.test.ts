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
const stylesheetPath = resolve(import.meta.dir, "styles/docsDiagram.css");

function usedClasses(svg: string): Set<string> {
  const classes = new Set<string>();
  for (const match of svg.matchAll(/\sclass="([^"]+)"/g)) {
    for (const name of (match[1] ?? "").split(/\s+/)) classes.add(name);
  }
  return classes;
}

describe("inlineDocsDiagram", () => {
  test("strips the standalone style and size from the access diagram", async () => {
    const markup = inlineDocsDiagram(await Bun.file(accessKeyingPath).text());
    expect(markup).not.toContain("<style");
    expect(markup).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    const root = markup.match(/<svg\b[^>]*>/)?.[0] ?? "";
    expect(root).toContain('viewBox="0 0 1500 1080"');
    expect(root).toContain('class="docs-diagram-svg"');
    expect(root).toContain('role="img"');
    expect(root).not.toMatch(/\s(?:width|height|font-family)=/);
    expect(markup).toContain(
      "<title>Tearleads access lookup and keying</title>",
    );
    expect(markup).toContain('marker-end="url(#access-keying-arrow)"');
    expect(markup).toContain('id="access-keying-arrow"');
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
  test("styles every class the access diagram uses", async () => {
    const svg = await Bun.file(accessKeyingPath).text();
    const css = await Bun.file(stylesheetPath).text();
    const unstyled = [...usedClasses(inlineDocsDiagram(svg))].filter(
      (name) =>
        name !== "docs-diagram-svg" &&
        !new RegExp(`\\.docs-diagram \\.${name}\\b(?!-)`).test(css),
    );
    expect(unstyled).toEqual([]);
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
