import { expect, type Locator } from "@playwright/test";

// Blob URLs resolve asynchronously. Require decoded pixels for every image.
export async function assertImagesDecoded(
  images: Locator,
  count: number,
): Promise<void> {
  await expect(images).toHaveCount(count, { timeout: 20_000 });
  for (let i = 0; i < count; i++) {
    await expect(images.nth(i)).toHaveJSProperty("complete", true);
    await expect(images.nth(i)).not.toHaveJSProperty("naturalWidth", 0);
  }
}
