import { expect, test } from "@playwright/test";
import { createFirstIdentity } from "./createFirstIdentity";

test("blob thumbnails resize without stretching the MIME column or losing row alignment", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/notes");
  await createFirstIdentity(page);
  // The empty-list action appears once the notes directory finishes loading.
  await page.getByRole("button", { name: "No notes. Create one" }).click();
  await expect(
    page.getByRole("textbox", { name: "Notes editor" }),
  ).toBeEditable();
  await page.locator(".note-document-file-input").setInputFiles({
    name: "thumbnail.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="60"><rect width="90" height="60"/></svg>',
    ),
  });
  await expect(
    page.getByRole("button", { name: "Open thumbnail.svg" }),
  ).toBeVisible();
  await page.goto("/app/explorer/blobs");

  const table = page.getByRole("table", { name: "Blob Browser" });
  const image = table.locator(".explorer-blob-browser-thumb-image").first();
  const toggle = page.getByRole("checkbox", { name: "Large thumbnails" });
  await expect(image).toBeVisible();

  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const mime = table.getByRole("columnheader", { name: "MIME", exact: true });
    await expect(mime).toHaveCount(width === 390 ? 0 : 1);
    const small = await image.boundingBox();
    if (!small) throw new Error("Missing thumbnail");
    await toggle.check();
    await expect
      .poll(async () => (await image.boundingBox())?.width ?? 0)
      .toBeGreaterThan(small.width * 1.5);
    const geometry = await image.evaluate((img) => {
      const row = img.closest("tr");
      if (!row) throw new Error("Missing blob row");
      return {
        height: row.getBoundingClientRect().height,
        pitch: Number.parseFloat(
          getComputedStyle(row).getPropertyValue(
            "--mini-app-virtual-row-height",
          ),
        ),
      };
    });
    expect(geometry.height).toBeCloseTo(geometry.pitch, 0);
    if (width === 1440) {
      const size = table.getByRole("columnheader", {
        name: "Size",
        exact: true,
      });
      const mimeBox = await mime.boundingBox();
      const sizeBox = await size.boundingBox();
      if (!mimeBox || !sizeBox) throw new Error("Missing MIME or Size column");
      expect(sizeBox.x - mimeBox.x).toBeLessThanOrEqual(200);
      await page.reload();
      await expect(toggle).toBeChecked();
    }
    await toggle.uncheck();
    await expect
      .poll(async () => (await image.boundingBox())?.width)
      .toBe(small.width);
  }
});
