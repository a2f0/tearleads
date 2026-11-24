import { expect, type Page, test } from "@playwright/test";
import { createFirstIdentity } from "./createFirstIdentity";

const ACKNOWLEDGEMENT = /Type i understand to continue/u;

async function revealPassphrase(page: Page): Promise<string> {
  await page.getByRole("button", { name: "View Recovery Key" }).click();
  await page.getByLabel(ACKNOWLEDGEMENT).fill("i understand");
  await page.getByRole("button", { name: "Show Passphrase" }).click();
  return page
    .getByRole("textbox", { name: "Passphrase", exact: true })
    .inputValue();
}

async function noHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
}

/**
 * Replaces the camera with a real video stream of a canvas, blank until
 * `window.showRecoveryQr()` draws the rendered recovery QR into it, so the
 * production video reader and QR decoder run unchanged.
 */
async function installQrCamera(page: Page, imageSource: string) {
  await page.evaluate(async (source) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 640;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable.");
    context.imageSmoothingEnabled = false;
    let showCode = false;
    Reflect.set(window, "showRecoveryQr", () => {
      showCode = true;
    });
    const draw = () => {
      context.fillStyle = "white";
      context.fillRect(0, 0, 640, 640);
      if (showCode) context.drawImage(image, 64, 64, 512, 512);
    };
    draw();
    const stream = canvas.captureStream(10);
    const timer = setInterval(draw, 100);
    stream
      .getVideoTracks()[0]
      ?.addEventListener("ended", () => clearInterval(timer));
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => stream,
    });
  }, imageSource);
}

test("a new phone restores its identity at onboarding from the recovery QR", async ({
  browser,
  page,
  baseURL,
}) => {
  test.setTimeout(60_000);
  if (!baseURL)
    throw new Error("The browser test requires a configured base URL.");
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/app/identity-manager/recovery-key");
  await createFirstIdentity(page);
  const reveal = page.getByRole("button", { name: "QR Code for Recovery Key" });
  await expect(reveal).toBeVisible({ timeout: 30_000 });
  await reveal.click();
  await page.getByLabel(ACKNOWLEDGEMENT).fill("i understand");
  await page.getByRole("button", { name: "Show QR Code" }).click();
  const source = await page
    .getByAltText("Recovery key QR code")
    .getAttribute("src");
  if (!source) throw new Error("Missing recovery QR image.");
  const phrase = await revealPassphrase(page);

  const phone = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  try {
    const phonePage = await phone.newPage();
    await phonePage.goto("/app/identity-manager/recovery-key");
    await phonePage
      .getByRole("button", { name: "Restore identity", exact: true })
      .first()
      .click();
    await installQrCamera(phonePage, source);
    await phonePage
      .getByRole("button", { name: "Restore from QR code" })
      .first()
      .click();

    // The open camera fits the phone before any code is in view.
    const camera = phonePage.getByLabel("Recovery QR code camera").first();
    await expect(camera).toBeVisible();
    const box = await camera.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    expect(await noHorizontalScroll(phonePage)).toBe(true);

    await phonePage.evaluate(() =>
      (Reflect.get(window, "showRecoveryQr") as () => void)(),
    );
    await expect(
      phonePage.getByRole("button", { name: "QR Code for Recovery Key" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(phonePage.getByLabel("Recovery QR code camera")).toHaveCount(
      0,
    );
    expect(await revealPassphrase(phonePage)).toBe(phrase);
    expect(await noHorizontalScroll(phonePage)).toBe(true);
  } finally {
    await phone.close();
  }
});
