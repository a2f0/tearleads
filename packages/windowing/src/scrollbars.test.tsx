import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Menu } from "./menu/Menu";
import { MenuItem } from "./menu/MenuItem";
import { renderRoutedPane } from "./routed/routedPane.testUtils";
import { Window } from "./window/Window";
import {
  useWindowActions,
  useWindowStateData,
  WindowStateProvider,
} from "./window/WindowStateProvider";

// Every stylesheet the package ships, tokens.css included.
const stylesheets = readdirSync(import.meta.dir, { recursive: true })
  .map(String)
  .filter((file) => file.endsWith(".css"))
  .map((file) => readFileSync(join(import.meta.dir, file), "utf8"))
  .join("\n");

const DARK_THEME = ":root { --color-dark: #e5e5e5; --color-light: #161616; }";

afterEach(() => {
  cleanup();
  document.head.replaceChildren();
});

function addStyles(...sheets: string[]): void {
  for (const sheet of sheets) {
    const style = document.createElement("style");
    style.textContent = sheet;
    document.head.append(style);
  }
}

function NotesContent() {
  return <p>notes</p>;
}

function Desktop() {
  const { windows } = useWindowStateData();
  const { create } = useWindowActions();
  return (
    <>
      <button type="button" onClick={() => create("Notes", 0, 0, NotesContent)}>
        Open notes
      </button>
      {windows.map((entry) => (
        <Window key={entry.id} windowId={entry.id} />
      ))}
      <Menu position={{ x: 10, y: 10 }} onClose={() => {}}>
        <MenuItem label="Rename" onClick={() => {}} />
      </Menu>
    </>
  );
}

// The surfaces, which set the scrollbar color for everything in them to
// inherit, and the scroll containers inside them, which scrollbar-width (not
// inherited) must reach directly.
const SURFACES = [".window", ".menu", ".routed-pane"];
const SCROLLERS = [".window-body-content-scroll", ".routed-pane-main"];

function renderChrome(): void {
  const desktop = render(
    <WindowStateProvider>
      <Desktop />
    </WindowStateProvider>,
  );
  fireEvent.click(desktop.getByRole("button", { name: "Open notes" }));
  renderRoutedPane();
}

function styleOf(selector: string): CSSStyleDeclaration {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`${selector} not rendered`);
  return getComputedStyle(element);
}

// happy-dom keeps the declaration's line breaks, which a browser drops when it
// computes the colors.
function scrollbarColors(): string[] {
  return SURFACES.map((selector) =>
    styleOf(selector).scrollbarColor.replace(/\s+/g, " "),
  );
}

function scrollbarWidths(): string[] {
  return [...SURFACES, ...SCROLLERS].map(
    (selector) => styleOf(selector).scrollbarWidth,
  );
}

const THIN = Array(SURFACES.length + SCROLLERS.length).fill("thin");

describe("scrollbars", () => {
  test("are thin, with a thumb mixed from the default foreground", () => {
    addStyles(stylesheets);
    renderChrome();
    expect(scrollbarColors()).toEqual(
      Array(SURFACES.length).fill(
        "color-mix(in srgb, #333 32%, transparent) transparent",
      ),
    );
    expect(scrollbarWidths()).toEqual(THIN);
  });

  test("follow a host theme's foreground", () => {
    addStyles(stylesheets, DARK_THEME);
    renderChrome();
    expect(scrollbarColors()).toEqual(
      Array(SURFACES.length).fill(
        "color-mix(in srgb, #e5e5e5 32%, transparent) transparent",
      ),
    );
  });

  // A theme scoped below the root, as a host may give one part of its page,
  // recolors the thumb on the surfaces inside it.
  test("follow a theme scoped below the root", () => {
    addStyles(stylesheets, "body { --color-dark: #e5e5e5; }");
    renderChrome();
    expect(scrollbarColors()).toEqual(
      Array(SURFACES.length).fill(
        "color-mix(in srgb, #e5e5e5 32%, transparent) transparent",
      ),
    );
  });

  // A universal rule has no specificity either, so it wins by coming later.
  test("yield to a host's own scrollbar rules", () => {
    addStyles(stylesheets, "* { scrollbar-width: auto; }");
    renderChrome();
    expect(scrollbarWidths()).toEqual(THIN.map(() => "auto"));
  });

  test("take a host's scrollbar colors", () => {
    addStyles(
      stylesheets,
      ":root { --scrollbar-thumb: #808080; --scrollbar-track: #202020; }",
    );
    renderChrome();
    expect(scrollbarColors()).toEqual(
      Array(SURFACES.length).fill("#808080 #202020"),
    );
  });
});
