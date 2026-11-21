import type { Locator } from "@playwright/test";
import { expect, test } from "./appTest";
import { contrastRatio } from "./colorContrast";

/*
 * A confirmation sets its runtime value apart (the phrase the user must type,
 * or the name of what the action changes) with `MiniAppModalHighlight`.
 * Weight cannot carry that distinction: `:root` sets `font-synthesis: none`,
 * and Android's monospace face ships no bold, so a bold phrase rendered as
 * plain text there. These assertions read only the chip's ring and fill, which
 * do not depend on the font, so they hold where no bold face exists.
 *
 * Reset Device is the subject because it reaches the routed phone tier without
 * auth or seeded data and shares `PhraseConfirmationDialog` with every other
 * typed-phrase confirmation. Dark matters most: its emphasis fill sits a single
 * step above the panel, so the ring alone has to set the phrase apart there.
 */

interface HighlightColors {
  readonly fill: string;
  readonly panel: string;
  readonly ring: string;
  readonly ringStyle: string;
  readonly ringWidth: string;
  readonly text: string;
}

function readHighlightColors(phrase: Locator): Promise<HighlightColors> {
  return phrase.evaluate((element) => {
    const panel = element.closest(".mini-app-modal-panel");
    if (!panel) {
      throw new Error("The confirmation phrase is outside a modal panel.");
    }
    const style = getComputedStyle(element);
    return {
      fill: style.backgroundColor,
      panel: getComputedStyle(panel).backgroundColor,
      ring: style.borderTopColor,
      ringStyle: style.borderTopStyle,
      ringWidth: style.borderTopWidth,
      text: style.color,
    };
  });
}

test("the phrase to type stays set apart in every theme without relying on bold", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/identity-manager/local-data");
  const reset = page.getByRole("button", { name: "Reset Device" });
  await expect(reset).toBeVisible({ timeout: 30_000 });

  const measured: string[] = [];
  for (let step = 0; step < 3; step += 1) {
    const theme = await page.locator("html").getAttribute("data-theme");
    if (!theme) throw new Error("The app shell stamped no data-theme.");
    measured.push(theme);

    await reset.click();
    const dialog = page.getByRole("dialog", { name: "Reset this device" });
    const phrase = dialog.getByText("reset device", { exact: true });
    await expect(phrase).toBeVisible();
    const colors = await readHighlightColors(phrase);

    expect(colors.ringStyle, theme).toBe("solid");
    expect(Number.parseFloat(colors.ringWidth), theme).toBeGreaterThanOrEqual(
      1,
    );
    // WCAG 1.4.11 non-text contrast: the ring has to read against the panel.
    expect(contrastRatio(colors.ring, colors.panel), theme).toBeGreaterThan(3);
    expect(contrastRatio(colors.text, colors.fill), theme).toBeGreaterThan(4.5);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: /^Switch to \w+ theme$/u }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", theme);
  }

  expect(new Set(measured)).toEqual(new Set(["dark", "dusk", "light"]));
});
