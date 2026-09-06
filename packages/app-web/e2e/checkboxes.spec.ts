import { expect, type Locator, test } from "@playwright/test";

async function readAppearance(checkbox: Locator) {
  return checkbox.evaluate((element) => {
    const style = getComputedStyle(element);
    const mark = getComputedStyle(element, "::after");
    return {
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
      borderWidth: Number.parseFloat(style.borderTopWidth),
      borderColor: style.borderTopColor,
      background: style.backgroundColor,
      markContent: mark.content,
      markColor: mark.borderBottomColor,
      markWidth: Number.parseFloat(mark.borderBottomWidth),
    };
  });
}

// DOM-only tests cannot catch an appearance reset erasing the checkbox.
for (const colorScheme of ["light", "dark"] as const) {
  for (const mobile of [false, true]) {
    test.describe(`${colorScheme} ${mobile ? "mobile" : "desktop"}`, () => {
      test.use({ colorScheme });

      test("backup checkbox has a border and a distinct checked state", async ({
        page,
      }) => {
        await page.setViewportSize(
          mobile ? { width: 390, height: 844 } : { width: 1440, height: 1200 },
        );
        await page.goto(mobile ? "/app/backup-restore" : "/");
        if (!mobile) {
          const pane = page.locator(".pane:not(.pane-hidden)").first();
          await expect(pane.locator(".pane-footer")).toBeVisible();
          await page
            .waitForLoadState("networkidle", { timeout: 2_000 })
            .catch(() => {});
          await pane.getByRole("button", { name: "Menu", exact: true }).click();
          await page
            .locator(".menu")
            .getByRole("button", { name: "Backup / Restore", exact: true })
            .click();
        }

        const checkbox = page.getByRole("checkbox", {
          name: "Back up without a password",
        });
        const label = page.locator("label").filter({ has: checkbox });
        await expect(checkbox).toBeVisible();
        await expect(checkbox).not.toBeChecked();
        const unchecked = await readAppearance(checkbox);
        expect(unchecked.width).toBeGreaterThanOrEqual(12);
        expect(unchecked.height).toBe(unchecked.width);
        expect(unchecked.borderWidth).toBeGreaterThanOrEqual(1);
        expect(unchecked.borderColor).not.toBe(unchecked.background);
        expect(unchecked.markContent).toBe("none");
        if (mobile) {
          const box = await label.boundingBox();
          expect(box?.height).toBeGreaterThanOrEqual(44);
        }

        // Clicking the label changes both the visual and the backup form.
        await page
          .getByText("Back up without a password", { exact: true })
          .click();
        await expect(checkbox).toBeChecked();
        await expect(page.getByLabel("Password", { exact: true })).toHaveCount(
          0,
        );
        const checked = await readAppearance(checkbox);
        expect(checked.background).not.toBe(unchecked.background);
        expect(checked.borderWidth).toBe(unchecked.borderWidth);
        expect(checked.markContent).toBe('""');
        expect(checked.markWidth).toBeGreaterThanOrEqual(1);
        expect(checked.markColor).not.toBe(checked.background);

        // Native Space activation and a visible focus ring survive the reset.
        await checkbox.press("Space");
        await expect(checkbox).not.toBeChecked();
        await expect(checkbox).toBeFocused();
        await expect(checkbox).toHaveCSS("outline-style", "solid");
        await expect(checkbox).toHaveCSS("outline-width", "2px");
        await expect(
          page.getByLabel("Password", { exact: true }),
        ).toBeVisible();
      });
    });
  }
}
