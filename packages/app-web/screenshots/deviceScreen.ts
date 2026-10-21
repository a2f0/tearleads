import { writeFile } from "node:fs/promises";
import type { Page } from "@playwright/test";

// Routed (phone and tablet) captures are saved as the device's screen: the
// display's rounded corners are transparent, so every place that shows a
// capture gets the shape without its own mask. Radii are the display corners of
// the emulated devices, in CSS pixels: iPhone 13 (47.33pt) and iPad Pro 11
// (18pt). Viewports narrower than the app's 760px mobile breakpoint are phones
// (packages/app/src/navigation/breakpoints.ts).
const PHONE_CORNER_RADIUS = 47.33;
const TABLET_CORNER_RADIUS = 18;
const PHONE_MAX_WIDTH = 760;

// The test-deployment strip describes the hosted service, not the screen being
// shown; the website states the same release status beside the captures.
const HIDE_DEPLOYMENT_BANNER_CSS = `
  .test-system-banner {
    display: none !important;
  }
`;

/**
 * Screenshots the viewport as a device screen with transparent rounded
 * corners. Navigation resets injected styles, so the banner is hidden here on
 * every capture.
 */
export async function screenshotDeviceScreen(
  page: Page,
  filePath: string,
): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error("Device screen captures need a fixed viewport.");
  }
  await page.addStyleTag({ content: HIDE_DEPLOYMENT_BANNER_CSS });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const capture = await page.screenshot({ fullPage: false });
  const radius =
    viewport.width < PHONE_MAX_WIDTH
      ? PHONE_CORNER_RADIUS
      : TABLET_CORNER_RADIUS;
  // Decoding from a Blob keeps the image off the network, so the app's
  // Content-Security-Policy does not apply to it.
  const rounded = await page.evaluate(
    async ({ base64, cssRadius, cssWidth }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No 2D canvas context.");
      context.drawImage(bitmap, 0, 0);
      context.globalCompositeOperation = "destination-in";
      context.beginPath();
      context.roundRect(
        0,
        0,
        bitmap.width,
        bitmap.height,
        cssRadius * (bitmap.width / cssWidth),
      );
      context.fill();
      const png = new Uint8Array(
        await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
      );
      let binary = "";
      for (let offset = 0; offset < png.length; offset += 0x8000) {
        binary += String.fromCharCode(...png.subarray(offset, offset + 0x8000));
      }
      return btoa(binary);
    },
    {
      base64: capture.toString("base64"),
      cssRadius: radius,
      cssWidth: viewport.width,
    },
  );
  await writeFile(filePath, Buffer.from(rounded, "base64"));
}
