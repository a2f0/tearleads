import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./appTest";
import { openWindowedDesktop } from "./windowedDesktop";

/*
 * A note fills its pane: the editor runs edge to edge and meets whatever bounds
 * it above (the Explorer's title rule, or the top of the Notes mini-app's pane)
 * and the attachments tray below it, so its focus ring frames the pane with no
 * gap. The tray is the pane's foot: it spans the surface that shows the note
 * and ends where that surface does. In a window that surface is the window
 * body, so the tray meets the window's bottom edge, and the status bar, when it
 * shows, runs the full width directly under it. In the routed shell it is the
 * routed pane's main area.
 *
 * Both hosts of the note are measured: the Explorer, whose pane runs out from
 * the mini-app root's padding, and the Notes mini-app, whose root has none.
 */

interface Box {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

interface TrayFit {
  readonly editor: Box;
  /** Where the editor's text starts. */
  readonly editorTextLeft: number;
  /** The focus ring's offset plus its width: zero when it is on the edge. */
  readonly ringInset: number;
  readonly surface: Box;
  /** Where the Explorer's title starts; null in the Notes mini-app. */
  readonly titleLeft: number | null;
  /** The line the editor's top meets: the title rule's lower edge. */
  readonly topBound: number;
  readonly tray: Box;
}

const SURFACES = {
  "an Explorer window": { explorer: true, surface: ".window-body" },
  "the routed Explorer": { explorer: true, surface: ".routed-pane-main" },
  "the routed Notes mini-app": {
    explorer: false,
    surface: ".routed-pane-main",
  },
} as const;

type SurfaceName = keyof typeof SURFACES;

function noteEditor(page: Page): Locator {
  return page.getByRole("textbox", { name: "Notes editor" });
}

async function openNewNote(page: Page, surface: SurfaceName): Promise<void> {
  if (surface === "an Explorer window") {
    await openWindowedDesktop(page);
    await page.locator(".pane-footer-menu-button").first().click();
    await page
      .locator(".menu")
      .getByRole("button", { name: "Explorer", exact: true })
      .click();
    const window = page.locator(".window").first();
    await window.getByRole("button", { name: "New Document" }).click();
    await window.getByRole("button", { name: "Note", exact: true }).click();
  } else if (surface === "the routed Explorer") {
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.goto("/app/explorer");
    await page.getByRole("button", { name: "New Document" }).first().click();
    await page.getByRole("button", { name: "Note", exact: true }).click();
  } else {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app/notes");
    await page
      .getByRole("button", { name: "No notes. Create one", exact: true })
      .click({ timeout: 30_000 });
  }
  await expect(noteEditor(page)).toBeEditable({ timeout: 30_000 });
}

function measureTray(page: Page, surfaceSelector: string): Promise<TrayFit> {
  return noteEditor(page).evaluate((editor, selector) => {
    const tray = editor
      .closest(".note-document-scroll")
      ?.querySelector(".note-document-dropzone");
    const surface = editor.closest(selector);
    if (!tray || !surface) {
      throw new Error("Expected the note's tray inside its surface.");
    }
    const box = (element: Element) => {
      const { bottom, left, right, top } = element.getBoundingClientRect();
      return { bottom, left, right, top };
    };
    const style = getComputedStyle(editor);
    const pane = editor.closest(".explorer-inline-note");
    const title = editor
      .closest(".explorer-detail--note")
      ?.querySelector(".mini-app-header");
    return {
      editor: box(editor),
      editorTextLeft:
        editor.getBoundingClientRect().left +
        Number.parseFloat(style.paddingLeft),
      ringInset:
        Number.parseFloat(style.outlineOffset) +
        Number.parseFloat(style.outlineWidth),
      surface: box(surface),
      titleLeft: title ? title.getBoundingClientRect().left : null,
      topBound: pane
        ? pane.getBoundingClientRect().top +
          Number.parseFloat(getComputedStyle(pane).borderTopWidth)
        : surface.getBoundingClientRect().top,
      tray: box(tray),
    };
  }, surfaceSelector);
}

function expectTrayFillsFoot(fit: TrayFit): void {
  expect(fit.tray.left).toBeCloseTo(fit.surface.left, 0);
  expect(fit.tray.right).toBeCloseTo(fit.surface.right, 0);
  expect(fit.tray.bottom).toBeCloseTo(fit.surface.bottom, 0);
}

for (const [name, { explorer, surface }] of Object.entries(SURFACES) as Array<
  [SurfaceName, (typeof SURFACES)[SurfaceName]]
>) {
  test(`a note fills ${name}, its tray spanning the foot`, async ({ page }) => {
    test.setTimeout(90_000);
    await openNewNote(page, name);
    await noteEditor(page).focus();

    const fit = await measureTray(page, surface);
    expectTrayFillsFoot(fit);
    // The editor fills the pane between the bound above and the tray below.
    expect(fit.editor.left).toBeCloseTo(fit.surface.left, 0);
    expect(fit.editor.right).toBeCloseTo(fit.surface.right, 0);
    expect(fit.editor.top).toBeCloseTo(fit.topBound, 0);
    expect(fit.editor.bottom).toBeCloseTo(fit.tray.top, 0);
    // Its focus ring is drawn on that edge, not a pixel inside it.
    expect(fit.ringInset).toBe(0);
    if (explorer) {
      // The text lines up with the title above it.
      expect(fit.titleLeft).not.toBeNull();
      expect(fit.editorTextLeft).toBeCloseTo(fit.titleLeft ?? 0, 0);
    }
  });
}

test("a window's status bar runs full width under the attachments tray", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openNewNote(page, "an Explorer window");
  const window = page.locator(".window").first();
  const resting = await measureTray(page, ".window-body");

  await window.getByRole("menuitem", { name: "View" }).click();
  await window.getByRole("menuitem", { name: "Move Window" }).click();
  const statusBar = window.locator(".window-statusbar");
  await expect(statusBar).toBeVisible();

  const shown = await measureTray(page, ".window-body");
  const bar = await statusBar.boundingBox();
  if (!bar) {
    throw new Error("Expected a rendered status bar.");
  }
  // The body gave the bar its height, and the tray moved up with the body.
  expectTrayFillsFoot(shown);
  expect(shown.tray.bottom).toBeLessThan(resting.tray.bottom - 1);
  expect(bar.y).toBeCloseTo(shown.tray.bottom, 0);
  expect(bar.x).toBeCloseTo(shown.tray.left, 0);
  expect(bar.x + bar.width).toBeCloseTo(shown.tray.right, 0);
  await page.keyboard.press("Escape");
});
