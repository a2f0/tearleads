import { expect, type Page } from "@playwright/test";

const ACKNOWLEDGEMENT = /Type i understand to continue/u;

/** Shows the open identity's recovery QR and returns its rendered image. */
export async function showRecoveryQr(page: Page): Promise<string> {
  const reveal = page.getByRole("button", { name: "QR Code for Recovery Key" });
  await expect(reveal).toBeVisible({ timeout: 30_000 });
  await reveal.click();
  await page.getByLabel(ACKNOWLEDGEMENT).fill("i understand");
  await page.getByRole("button", { name: "Show QR Code" }).click();
  const qr = page.getByAltText("Recovery key QR code");
  await expect(qr).toBeVisible();
  const source = await qr.getAttribute("src");
  if (!source) throw new Error("Missing recovery QR image.");
  return source;
}

/** Reveals the open identity's recovery passphrase and returns it. */
export async function revealRecoveryPassphrase(page: Page): Promise<string> {
  await page.getByRole("button", { name: "View Recovery Key" }).click();
  await page.getByLabel(ACKNOWLEDGEMENT).fill("i understand");
  await page.getByRole("button", { name: "Show Passphrase" }).click();
  return page
    .getByRole("textbox", { name: "Passphrase", exact: true })
    .inputValue();
}

/**
 * Replaces the camera with a real video stream of a canvas showing the rendered
 * recovery QR, so the production video reader and QR decoder run unchanged.
 * With `blank`, the stream stays empty until `pointCameraAtRecoveryQr`.
 */
export async function installRecoveryQrCamera(
  page: Page,
  imageSource: string,
  { blank = false }: { blank?: boolean } = {},
): Promise<void> {
  await page.evaluate(
    async ({ source, startBlank }) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 640;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable.");
      context.imageSmoothingEnabled = false;
      let showCode = !startBlank;
      Reflect.set(window, "pointCameraAtRecoveryQr", () => {
        showCode = true;
      });
      const draw = () => {
        context.fillStyle = "white";
        context.fillRect(0, 0, 640, 640);
        if (showCode) context.drawImage(image, 64, 64, 512, 512);
      };
      draw();
      const stream = canvas.captureStream(10);
      // Keep producing frames after the production video starts playing.
      const timer = setInterval(draw, 100);
      stream
        .getVideoTracks()[0]
        ?.addEventListener("ended", () => clearInterval(timer));
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async () => stream,
      });
    },
    { source: imageSource, startBlank: blank },
  );
}

/** Brings the QR into view of a camera installed with `blank`. */
export async function pointCameraAtRecoveryQr(page: Page): Promise<void> {
  await page.evaluate(() =>
    (Reflect.get(window, "pointCameraAtRecoveryQr") as () => void)(),
  );
}

export async function hasNoHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
}
