import { expect, test } from "@playwright/test";
import { createFirstIdentity } from "./createFirstIdentity";
import {
  hasNoHorizontalScroll,
  installRecoveryQrCamera,
  pointCameraAtRecoveryQr,
  revealRecoveryPassphrase,
  showRecoveryQr,
} from "./recoveryQrCamera";

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
  const source = await showRecoveryQr(page);
  const phrase = await revealRecoveryPassphrase(page);

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
    await installRecoveryQrCamera(phonePage, source, { blank: true });
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
    expect(await hasNoHorizontalScroll(phonePage)).toBe(true);

    await pointCameraAtRecoveryQr(phonePage);
    await expect(
      phonePage.getByRole("button", { name: "QR Code for Recovery Key" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(phonePage.getByLabel("Recovery QR code camera")).toHaveCount(
      0,
    );
    expect(await revealRecoveryPassphrase(phonePage)).toBe(phrase);
    expect(await hasNoHorizontalScroll(phonePage)).toBe(true);
  } finally {
    await phone.close();
  }
});
