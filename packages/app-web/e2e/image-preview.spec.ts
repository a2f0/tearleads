import { expect, type Locator, type Page, test } from "@playwright/test";

/*
 * A file document's image preview, measured in a real engine. Its fit is pure
 * layout — a media element sized by the frame around it and letterboxed with
 * `object-fit` — so happy-dom, which runs no layout at all, can only assert the
 * class names that ask for it. What broke before was the geometry: percentage
 * heights resolved against an indefinite parent, the image kept its intrinsic
 * height, and a tall picture was clipped by the frame it overflowed. Only a
 * browser can catch that, so these assert boxes rather than markup.
 */

// A deliberately tall picture (1:3.3): under the old rules its rendered height
// ran to several times the frame's, which is exactly the crop.
const TALL_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="1000" viewBox="0 0 300 1000">
  <rect width="300" height="1000" fill="#f5c518"/>
  <rect x="10" y="10" width="280" height="980" fill="none" stroke="#0d6b32" stroke-width="20"/>
</svg>`;

// The desktop shell opens on an empty desktop; Explorer is launched from the
// footer menu as a window, then maximized so the pane is the whole viewport.
async function openExplorerWindow(page: Page): Promise<Locator> {
  await page.goto("/");
  await page.locator(".pane-footer-menu-button").first().click();
  await page
    .locator(".menu")
    .getByRole("button", { name: "Explorer", exact: true })
    .click();

  const window = page.locator(".window").first();
  await expect(window).toBeVisible({ timeout: 30_000 });
  await window.locator(".window-maximize").click();
  return window;
}

async function openUploadedImage(
  page: Page,
  fileName: string,
): Promise<Locator> {
  const window = await openExplorerWindow(page);

  const upload = window.getByRole("button", { name: "Upload", exact: true });
  await expect(upload).toBeEnabled({ timeout: 30_000 });
  const chooser = page.waitForEvent("filechooser");
  await upload.click();
  await (await chooser).setFiles({
    buffer: Buffer.from(TALL_IMAGE),
    mimeType: "image/svg+xml",
    name: fileName,
  });

  const row = window
    .locator(".explorer-item-row-button", { hasText: fileName })
    .first();
  // Inside the suite's 30s per-test budget: a longer wait here could never be
  // reached, it would only be the test timeout that reported the failure.
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  return window;
}

test("a tall image preview fits its frame instead of being cropped", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  const window = await openUploadedImage(page, "tall-preview.svg");

  const frame = window.locator(".file-document-preview-frame").first();
  const image = window.locator("img.file-document-media-preview").first();
  await expect(image).toBeVisible({ timeout: 30_000 });
  await expect(image).toHaveJSProperty("complete", true);

  const frameBox = await frame.boundingBox();
  const imageBox = await image.boundingBox();
  if (!frameBox || !imageBox) {
    throw new Error("Expected the preview frame and image to be laid out.");
  }

  // The image is drawn inside the frame on both axes. Before the fix its box ran
  // several times the frame's height and the overflow was simply clipped.
  expect(imageBox.height).toBeLessThanOrEqual(frameBox.height + 1);
  expect(imageBox.width).toBeLessThanOrEqual(frameBox.width + 1);
  // ...and it is a real preview, not a collapsed sliver.
  expect(imageBox.height).toBeGreaterThan(100);
});

test("the preview takes the pane's spare height, leaving none below the metadata", async ({
  page,
}) => {
  // Tall enough that the old frame's 34rem ceiling could not reach the foot of
  // the pane; the gap it left below the metadata is what this measures.
  await page.setViewportSize({ width: 1024, height: 1000 });
  const window = await openUploadedImage(page, "tall-metadata.svg");

  const body = window.locator(".structured-document").first();
  const frame = window.locator(".file-document-preview-frame").first();
  const metadata = window.locator(".file-document-metadata").first();
  await expect(metadata).toBeVisible({ timeout: 30_000 });

  const bodyBox = await body.boundingBox();
  const frameBox = await frame.boundingBox();
  const metadataBox = await metadata.boundingBox();
  if (!bodyBox || !frameBox || !metadataBox) {
    throw new Error("Expected the document body to be laid out.");
  }

  // The metadata sits under the picture, and the slack the frame absorbed is
  // what used to be a dead band beneath those rows. The band is measured from
  // both sides: a negative one would mean the rows ran off the foot of the pane
  // — no wasted space, but only because the metadata is no longer on screen.
  expect(metadataBox.y).toBeGreaterThan(frameBox.y + frameBox.height - 1);
  const spareBelowMetadata =
    bodyBox.y + bodyBox.height - (metadataBox.y + metadataBox.height);
  expect(spareBelowMetadata).toBeGreaterThanOrEqual(0);
  expect(spareBelowMetadata).toBeLessThan(48);
});
