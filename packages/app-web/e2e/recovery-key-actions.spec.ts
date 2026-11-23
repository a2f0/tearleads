import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  BACKUP_AGREEMENT_LABEL,
  createFirstIdentity,
} from "./createFirstIdentity";
import { switchToWindowedDesktop } from "./windowedDesktop";

/*
 * The recovery key's actions are a menu: one borderless row per action, each a
 * glyph and a short label, highlighted on hover like the window toolbar. See
 * components/identity/recovery-key/RecoveryKeyBackup.css. Measured, not read
 * from the code, because the glyph size lives in CSS that outranks the icon's
 * own size attribute, and a row can collapse back into a toolbar line without
 * any query by role noticing.
 */

interface MenuGeometry {
  readonly controlHeight: number;
  readonly left: number;
  readonly width: number;
  readonly rows: readonly {
    readonly label: string;
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly width: number;
    readonly height: number;
    readonly iconWidth: number;
    readonly iconHeight: number;
    readonly borderColor: string;
  }[];
}

function readMenu(menu: Locator): Promise<MenuGeometry> {
  return menu.evaluate((list) => {
    const box = list.getBoundingClientRect();
    // The control height a framed button takes here, resolved in place.
    const probe = document.createElement("div");
    probe.style.height = "var(--control-height)";
    list.append(probe);
    const controlHeight = probe.getBoundingClientRect().height;
    probe.remove();
    return {
      controlHeight,
      left: box.left,
      width: box.width,
      rows: [...list.querySelectorAll(":scope > li > button")].map((row) => {
        const rowBox = row.getBoundingClientRect();
        const icon = row.querySelector("svg")?.getBoundingClientRect();
        return {
          label: row.textContent ?? "",
          top: rowBox.top,
          bottom: rowBox.bottom,
          left: rowBox.left,
          width: rowBox.width,
          height: rowBox.height,
          iconWidth: icon?.width ?? 0,
          iconHeight: icon?.height ?? 0,
          borderColor: getComputedStyle(row).borderTopColor,
        };
      }),
    };
  });
}

const TRANSPARENT = "rgba(0, 0, 0, 0)";

function expectMenu(
  geometry: MenuGeometry,
  expected: { readonly icon: number },
) {
  const labels = geometry.rows.map((row) => row.label);
  // Save appears only where the host offers a password manager.
  expect(labels[0]).toBe("View");
  expect(labels).toEqual(
    expect.arrayContaining(["View", "QR Code", "Print", "Download", "Copy"]),
  );
  expect(labels.at(-1)).toBe("Copy");
  for (const [index, row] of geometry.rows.entries()) {
    // One action per line, each spanning the menu.
    expect(row.left).toBe(geometry.left);
    expect(row.width).toBe(geometry.width);
    const previous = geometry.rows[index - 1];
    if (previous) expect(row.top).toBeGreaterThanOrEqual(previous.bottom);
    expect(row.height).toBeGreaterThanOrEqual(geometry.controlHeight);
    expect(row.iconWidth).toBe(expected.icon);
    expect(row.iconHeight).toBe(expected.icon);
    // Not a framed button: no border until it is hovered.
    expect(row.borderColor).toBe(TRANSPARENT);
  }
}

/** Moves the pointer off the menu, which the last click can leave it over. */
async function readMenuAtRest(page: Page, menu: Locator) {
  await page.mouse.move(0, 0);
  return readMenu(menu);
}

async function expectHoverHighlight(menu: Locator) {
  const row = menu.getByRole("button").first();
  await expect(row).toHaveCSS("background-color", TRANSPARENT);
  await row.hover();
  await expect(row).not.toHaveCSS("background-color", TRANSPARENT);
}

async function openRecoveryKey(page: Page) {
  await page.goto("/app/identity-manager/recovery-key");
  await createFirstIdentity(page);
  const menu = page.getByRole("list", { name: "Recovery key actions" });
  await expect(menu).toBeVisible({ timeout: 30_000 });
  return menu;
}

const ROUTED_TIERS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 900, height: 900 },
] as const;

for (const tier of ROUTED_TIERS) {
  test(`${tier.name} recovery key actions are touch-sized menu rows`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: tier.width, height: tier.height });
    const menu = await openRecoveryKey(page);

    const geometry = await readMenuAtRest(page, menu);
    expect(geometry.controlHeight).toBe(44);
    expectMenu(geometry, { icon: 24 });
    await expectHoverHighlight(menu);
  });
}

test("windowed recovery key actions keep a control-height row and a larger glyph", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRecoveryKey(page);
  await switchToWindowedDesktop(page);
  const menu = page
    .locator(".pane:not(.pane-hidden)")
    .first()
    .getByRole("list", { name: "Recovery key actions" });
  await expect(menu).toBeVisible({ timeout: 30_000 });

  // 20px glyphs, up from the toolbar's 16px; rows as tall as a control.
  expectMenu(await readMenuAtRest(page, menu), { icon: 20 });
  await expectHoverHighlight(menu);
});

test("the new-identity backup prompt centers the menu at the form's width", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/app/identity-manager/recovery-key");
  await page
    .getByRole("button", { name: "Create new identity", exact: true })
    .first()
    .click();
  const prompt = page
    .getByRole("textbox", { name: "What should we call you?" })
    .first();
  await prompt.fill("Bob");
  await prompt.press("Enter");
  await expect(page.getByLabel(BACKUP_AGREEMENT_LABEL).first()).toBeVisible({
    timeout: 30_000,
  });

  const menu = page.getByRole("list", { name: "Recovery key actions" });
  const panel = page.locator(".recovery-key-backup-confirmation");
  const geometry = await readMenuAtRest(page, menu);
  expectMenu(geometry, { icon: 24 });
  const panelBox = await panel.boundingBox();
  if (!panelBox) throw new Error("The backup prompt has no box.");
  // 20rem, centered under the prompt's copy.
  expect(geometry.width).toBe(320);
  expect(
    Math.abs(
      geometry.left + geometry.width / 2 - (panelBox.x + panelBox.width / 2),
    ),
  ).toBeLessThanOrEqual(1);
});
