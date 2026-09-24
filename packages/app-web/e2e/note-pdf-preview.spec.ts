import { expect, type Page, test } from "@playwright/test";
import { twoPagePdf } from "./pdfFixtures";
import { openWindowedDesktop } from "./windowedDesktop";

async function openNote(page: Page, surface: "explorer" | "notes") {
  if (surface === "notes") {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app/notes");
    await page.getByRole("button", { name: "New Note", exact: true }).click();
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
  await expect(
    page.getByRole("textbox", { name: "Notes editor" }),
  ).toBeEditable();
}

async function attachPdf(page: Page, name: string, buffer: Buffer) {
  await page.locator(".note-document-file-input").setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer,
  });
  await expect(
    page.getByRole("button", { name: `Open ${name}` }),
  ).toBeVisible();
}

for (const surface of ["explorer", "notes"] as const) {
  test(`${surface} note PDF attachment renders in its preview`, async ({
    page,
  }) => {
    await openNote(page, surface);
    await attachPdf(page, "reference.pdf", twoPagePdf());
    // A later PDF must not replace the attachment the user selected.
    await attachPdf(page, "other.pdf", Buffer.from("not a PDF"));
    await expect(page.locator(".file-document-pdf-widget")).toHaveCount(0);

    await page.getByRole("button", { name: "Open reference.pdf" }).click();
    const dialog = page.getByRole("dialog", {
      name: "reference.pdf",
      exact: true,
    });
    const pages = dialog.locator(".file-document-pdf-pages");
    await expect(dialog.locator(".pdfViewer .page")).toHaveCount(2);
    await expect(dialog.locator(".pdfViewer canvas").first()).toBeVisible();
    await expect(dialog.locator(".textLayer").first()).toContainText(
      "Page One",
    );
    await expect(dialog.getByText("1 / 2")).toBeVisible();

    const viewport = await pages.boundingBox();
    expect(viewport?.height).toBeGreaterThan(200);
    expect(viewport?.width).toBeGreaterThan(200);
    await dialog.getByRole("button", { name: "+", exact: true }).click();
    await dialog.getByRole("button", { name: "Fit width" }).click();
    await pages.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(dialog.getByText("2 / 2")).toBeVisible();
    await expect(dialog.locator(".textLayer").last()).toContainText("Page Two");

    const download = page.waitForEvent("download");
    await dialog
      .getByRole("button", { name: "Download reference.pdf" })
      .click();
    expect((await download).suggestedFilename()).toBe("reference.pdf");
    await dialog.getByRole("button", { name: "Close preview" }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Open reference.pdf" }).click();
    await expect(dialog.locator(".pdfViewer canvas").first()).toBeVisible();
  });
}

test("note PDF previews retain download when rendering is unavailable", async ({
  page,
}) => {
  await openNote(page, "notes");
  for (const [name, buffer, message] of [
    [
      "invalid.pdf",
      Buffer.from("not a PDF"),
      "Couldn't display this PDF. You can still download it.",
    ],
    [
      "large.pdf",
      Buffer.alloc(5 * 1024 * 1024 + 1),
      "PDF preview is unavailable or over 5 MiB. You can still download it.",
    ],
  ] as const) {
    await attachPdf(page, name, buffer);
    await page.getByRole("button", { name: `Open ${name}` }).click();
    const dialog = page.getByRole("dialog", { name, exact: true });
    await expect(dialog.getByText(message)).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: `Download ${name}` }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "Close preview" }).click();
  }
});

// The routed (tablet / mobile) shell must render the preview edge-to-edge over
// the main content pane — not as a floating centered card. Assert the drawn
// boxes rather than the classes: the fill lives in CSS (`sticky` plus 100%
// sizing keyed to the pane), so a dropped override would still carry every
// modifier class and only the browser's layout would show it.
for (const viewport of [
  { name: "tablet", width: 900, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
] as const) {
  test(`note preview fills the routed pane (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/app/notes");
    await page.getByRole("button", { name: "New Note", exact: true }).click();
    await page.getByRole("textbox", { name: "Notes editor" }).waitFor();
    await attachPdf(page, "reference.pdf", twoPagePdf());

    await page.getByRole("button", { name: "Open reference.pdf" }).click();
    const dialog = page.getByRole("dialog", {
      name: "reference.pdf",
      exact: true,
    });
    // The routed chrome keeps its compact bar and never draws window chrome.
    await expect(dialog.locator(".note-attachment-preview-bar")).toBeVisible();
    await expect(dialog.locator(".window-titlebar")).toHaveCount(0);

    const pane = page.locator(".routed-pane-main");
    const paneBox = await pane.boundingBox();
    const dialogBox = await dialog.boundingBox();
    if (!paneBox || !dialogBox) {
      throw new Error(
        "Expected the routed pane and preview boxes to be laid out.",
      );
    }
    expect(dialogBox.x).toBeCloseTo(paneBox.x, 0);
    expect(dialogBox.y).toBeCloseTo(paneBox.y, 0);
    expect(dialogBox.width).toBeCloseTo(paneBox.width, 0);
    expect(dialogBox.height).toBeCloseTo(paneBox.height, 0);

    // The preview's controls sit inside the pane, not clipped past it.
    const closeBox = await dialog
      .getByRole("button", { name: "Close preview" })
      .boundingBox();
    if (!closeBox) {
      throw new Error("Expected the preview close control to be laid out.");
    }
    expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(
      paneBox.x + paneBox.width,
    );

    await dialog.getByRole("button", { name: "Close preview" }).click();
    await expect(dialog).toHaveCount(0);
  });
}
