import { expect, test } from "@playwright/test";
import { createFirstIdentity } from "./createFirstIdentity";
import {
  hasNoHorizontalScroll,
  installRecoveryQrCamera,
  revealRecoveryPassphrase,
  showRecoveryQr,
} from "./recoveryQrCamera";

test("a second device scans the displayed recovery QR into its restore form", async ({
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
    await createFirstIdentity(phonePage);
    await expect(
      phonePage.getByRole("button", { name: "QR Code for Recovery Key" }),
    ).toBeVisible({ timeout: 30_000 });
    await phonePage.getByRole("tab", { name: "Recovery", exact: true }).click();
    await installRecoveryQrCamera(phonePage, source);
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
    expect(await hasNoHorizontalScroll(phonePage)).toBe(true);
  } finally {
    await phone.close();
  }
});
