import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./appTest";
import { contrastRatio } from "./colorContrast";
import { openWindowedDesktop } from "./windowedDesktop";

/*
 * A note in edit mode is one pane: the editor fills everything above the
 * attachments tray and scrolls its own text, so the tray stays put at the foot
 * of the pane however long the note grows. The routed case is the notes
 * mini-app on a phone; the windowed case is the Explorer's note renderer in a
 * desktop window — the two hosts of the shared note editor.
 */

type Surface = "routed" | "window";

const LONG_NOTE = Array.from(
  { length: 200 },
  (_, index) => `Line ${index + 1} of a note several screens long`,
).join("\n");

interface NoteLayout {
  readonly editorBottom: number;
  readonly editorClientHeight: number;
  readonly editorHeight: number;
  readonly editorHalfLeading: number;
  readonly editorPaddingBottom: number;
  readonly editorScrollHeight: number;
  readonly editorScrollTop: number;
  readonly paneBottom: number;
  readonly paneClientHeight: number;
  readonly paneScrollHeight: number;
  readonly paneTop: number;
  readonly trayBottom: number;
  readonly trayTop: number;
}

function noteEditor(page: Page): Locator {
  return page.getByRole("textbox", { name: "Notes editor" });
}

async function openNewNote(page: Page, surface: Surface): Promise<Locator> {
  if (surface === "routed") {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app/notes");
    await page
      .getByRole("button", { name: "No notes. Create one", exact: true })
      .click({ timeout: 30_000 });
  } else {
    await openWindowedDesktop(page);
    await page.locator(".pane-footer-menu-button").first().click();
    await page
      .locator(".menu")
      .getByRole("button", { name: "Explorer", exact: true })
      .click();
    const window = page.locator(".window").first();
    await window.getByRole("button", { name: "New Document" }).click();
    await window.getByRole("button", { name: "Note", exact: true }).click();
  }
  const editor = noteEditor(page);
  await expect(editor).toBeEditable({ timeout: 30_000 });
  return editor;
}

function measureNote(editor: Locator): Promise<NoteLayout> {
  return editor.evaluate((element) => {
    const pane = element.closest(".note-document-scroll");
    const tray = pane?.querySelector(".note-document-dropzone");
    if (!(element instanceof HTMLTextAreaElement) || !pane || !tray) {
      throw new Error("Expected the note editor inside its pane with a tray.");
    }
    const paneBox = pane.getBoundingClientRect();
    const editorBox = element.getBoundingClientRect();
    const trayBox = tray.getBoundingClientRect();
    return {
      editorBottom: editorBox.bottom,
      editorClientHeight: element.clientHeight,
      editorHeight: editorBox.height,
      editorHalfLeading:
        (Number.parseFloat(getComputedStyle(element).lineHeight) -
          Number.parseFloat(getComputedStyle(element).fontSize)) /
        2,
      editorPaddingBottom: Number.parseFloat(
        getComputedStyle(element).paddingBottom,
      ),
      editorScrollHeight: element.scrollHeight,
      editorScrollTop: element.scrollTop,
      paneBottom: paneBox.bottom,
      paneClientHeight: pane.clientHeight,
      paneScrollHeight: pane.scrollHeight,
      paneTop: paneBox.top,
      trayBottom: trayBox.bottom,
      trayTop: trayBox.top,
    };
  });
}

function expectTrayAtFootOfPane(layout: NoteLayout): void {
  // The pane itself never scrolls: the editor absorbs every spare pixel and
  // scrolls its own text instead.
  expect(layout.paneScrollHeight).toBeLessThanOrEqual(
    layout.paneClientHeight + 1,
  );
  expect(layout.trayTop).toBeGreaterThanOrEqual(layout.paneTop);
  expect(layout.trayBottom).toBeLessThanOrEqual(layout.paneBottom + 0.5);
  // The editor runs down to the tray and meets it: no gap between the two.
  expect(layout.trayTop).toBeCloseTo(layout.editorBottom, 0);
}

// The last line's glyphs are in view. A browser reveals the caret, which is as
// tall as the font, so the line's half-leading and the editor's bottom padding
// may stay just below the fold.
function expectLastLineInView(layout: NoteLayout): void {
  expect(layout.editorScrollTop + layout.editorClientHeight).toBeGreaterThan(
    layout.editorScrollHeight -
      layout.editorPaddingBottom -
      layout.editorHalfLeading -
      1,
  );
}

async function expectUploadUsable(page: Page): Promise<void> {
  const upload = page.getByRole("button", { name: "Upload", exact: true });
  await expect(upload).toBeInViewport({ ratio: 1 });
  const chooser = page.waitForEvent("filechooser");
  await upload.click();
  await chooser;
}

for (const surface of ["routed", "window"] as const) {
  test(`${surface} note editor fills the pane above its attachments`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const editor = await openNewNote(page, surface);

    // Typing starts without a click: the editor took focus as it opened.
    await expect(editor).toBeFocused();
    await page.keyboard.type("A one-line note");
    await expect(editor).toHaveValue("A one-line note");
    const short = await measureNote(editor);
    expectTrayAtFootOfPane(short);
    expect(short.editorScrollHeight).toBeLessThanOrEqual(
      short.editorClientHeight,
    );

    // Several screens of text scroll inside the editor; nothing moves.
    await editor.fill(LONG_NOTE);
    await page.keyboard.type("\nThe last line");
    const long = await measureNote(editor);
    expectTrayAtFootOfPane(long);
    expect(long.editorHeight).toBeCloseTo(short.editorHeight, 0);
    expect(long.editorScrollHeight).toBeGreaterThan(
      long.editorClientHeight * 2,
    );
    expectLastLineInView(long);
    await expectUploadUsable(page);

    // Scrolled back to the first line, the tray is still there to use.
    await editor.evaluate((element) => {
      element.scrollTop = 0;
    });
    expectTrayAtFootOfPane(await measureNote(editor));
    await expectUploadUsable(page);
  });
}

test("a reopened long note focuses its editor at the end of the text", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const editor = await openNewNote(page, "routed");
  await editor.fill(`${LONG_NOTE}\nThe last line`);
  await expect(page).toHaveURL(/\/app\/notes\/note\/.+/u);
  const noteUrl = page.url();

  // Leave for another note, then come back: the editor stays mounted while the
  // note under it is swapped out. Wait for the new note to open and take
  // focus, so the editor goes back to a note that is already loaded while it
  // still has focus.
  await page.getByRole("button", { name: "New Note", exact: true }).click();
  await expect(page).not.toHaveURL(noteUrl);
  await expect(editor).toHaveValue("");
  await expect(editor).toBeEditable();
  await expect(editor).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(noteUrl);
  await expect(editor).toHaveValue(`${LONG_NOTE}\nThe last line`, {
    timeout: 30_000,
  });
  await expect(editor).toBeFocused();
  const caret = await editor.evaluate((element) =>
    element instanceof HTMLTextAreaElement
      ? [element.selectionStart, element.selectionEnd, element.value.length]
      : null,
  );
  expect(caret?.[0]).toBe(caret?.[2]);
  expect(caret?.[1]).toBe(caret?.[2]);
  const reopened = await measureNote(editor);
  expectTrayAtFootOfPane(reopened);
  expectLastLineInView(reopened);
});

interface FocusRing {
  readonly background: string;
  readonly ring: string;
  readonly ringStyle: string;
  readonly ringWidth: string;
  readonly text: string;
  readonly token: string;
}

function readFocusRing(editor: Locator): Promise<FocusRing> {
  return editor.evaluate((element) => {
    let surface: Element | null = element;
    let background = "rgba(0, 0, 0, 0)";
    while (surface) {
      const color = getComputedStyle(surface).backgroundColor;
      if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
        background = color;
        break;
      }
      surface = surface.parentElement;
    }
    const swatch = document.createElement("span");
    swatch.style.color = "var(--app-editor-focus-ring)";
    element.after(swatch);
    const token = getComputedStyle(swatch).color;
    swatch.remove();
    const style = getComputedStyle(element);
    return {
      background,
      ring: style.outlineColor,
      ringStyle: style.outlineStyle,
      ringWidth: style.outlineWidth,
      text: style.color,
      token,
    };
  });
}

test("the note editor's focus ring is subdued but visible in every theme", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const editor = await openNewNote(page, "routed");

  const measured: string[] = [];
  for (let step = 0; step < 3; step += 1) {
    const theme = await page.locator("html").getAttribute("data-theme");
    if (!theme) throw new Error("The app shell stamped no data-theme.");
    measured.push(theme);

    await editor.focus();
    await expect(editor).toBeFocused();
    const colors = await readFocusRing(editor);
    expect(colors.ringStyle, theme).toBe("solid");
    expect(Number.parseFloat(colors.ringWidth), theme).toBeGreaterThanOrEqual(
      2,
    );
    // The ring draws in the theme's editor focus color, not the text color.
    expect(colors.ring, theme).toBe(colors.token);
    const ringContrast = contrastRatio(colors.ring, colors.background);
    // Still perceivable (WCAG 1.4.11 non-text contrast) …
    expect(ringContrast, theme).toBeGreaterThan(3);
    // … but well below the text it frames.
    expect(ringContrast, theme).toBeLessThan(
      contrastRatio(colors.text, colors.background) / 2,
    );

    await page.getByRole("button", { name: /^Switch to \w+ theme$/u }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", theme);
  }

  expect(new Set(measured)).toEqual(new Set(["dark", "dusk", "light"]));
});
