import { expect, test } from "@playwright/test";

test("a second device scans the displayed recovery QR into its restore form", async ({
  browser,
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/app/identity-manager/recovery-key");
  const reveal = page.getByRole("button", { name: "Reveal Recovery QR Code" });
  await expect(reveal).toBeVisible({ timeout: 30_000 });
  await reveal.click();
  await page.getByLabel(/Type i understand to continue/u).fill("i understand");
  await page.getByRole("button", { name: "Show QR Code" }).click();
  const qr = page.getByAltText("Recovery key QR code");
  await expect(qr).toBeVisible();
  const source = await qr.getAttribute("src");
  if (!source) throw new Error("Missing recovery QR image.");

  await page.getByRole("button", { name: "Hide Recovery Key" }).click();
  await page.getByRole("button", { name: "Reveal Recovery Key" }).click();
  await page.getByLabel(/Type i understand to continue/u).fill("i understand");
  await page.getByRole("button", { name: "Show Passphrase" }).click();
  const phrase = await page
    .getByRole("textbox", { name: "Passphrase", exact: true })
    .inputValue();

  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    const phonePage = await phone.newPage();
    await phonePage.goto(
      "http://127.0.0.1:3100/app/identity-manager/recovery-key",
    );
    await phonePage.getByRole("tab", { name: "Recovery", exact: true }).click();
    // Feed the actual rendered SVG into a real video stream. The production
    // canvas reader and QR decoder run unchanged in the second browser context.
    await phonePage.evaluate(async (imageSource) => {
      const image = new Image();
      image.src = imageSource;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 640;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable.");
      context.fillStyle = "white";
      context.fillRect(0, 0, 640, 640);
      context.drawImage(image, 64, 64, 512, 512);
      const stream = canvas.captureStream(10);
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async () => stream,
      });
    }, source);
    await phonePage.getByRole("button", { name: "Scan QR Code" }).click();
    await expect(
      phonePage.getByRole("textbox", { name: "Restore passphrase" }),
    ).toHaveValue(phrase);
    await expect(phonePage.getByLabel("Recovery QR code camera")).toHaveCount(
      0,
    );
    await expect(
      phonePage.getByRole("button", { name: "Restore from Passphrase" }),
    ).toBeEnabled();
    expect(
      await phonePage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await phone.close();
  }
});
