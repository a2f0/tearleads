import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./appTest";
import { measureAttached } from "./domMeasure";
import { switchToWindowedDesktop } from "./windowedDesktop";

/*
 * A modal takes over the region it blocks instead of floating a small card
 * over it (MiniAppModal.css): its panel fills a window's content section, the
 * routed pane, or the whole phone screen, and keeps its content in one
 * centered column that scrolls from its title when it does not fit. Each of
 * those is a CSS value over markup that looks right on its own, so assert
 * what the browser draws.
 *
 * Reset Device (a raised confirmation) and Explorer's Create Child Folder (a
 * section one) are the subjects because both open without auth or seeded data.
 */

interface Box {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

interface TakeoverGeometry {
  readonly column: Box;
  /** The column's cap in px, or null where the measure is released. */
  readonly measurePx: number | null;
  readonly panel: Box;
  readonly region: Box;
}

function readTakeover(
  dialog: Locator,
  regionSelector: string,
): Promise<TakeoverGeometry> {
  return measureAttached("modal takeover", () =>
    dialog.evaluate((panel, selector) => {
      if (!panel.isConnected) {
        return null;
      }
      const region = panel.closest(selector);
      const column = panel.querySelector(".mini-app-modal-form");
      if (!region || !column) {
        throw new Error(`The dialog sits outside ${selector} or has no form.`);
      }
      const box = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return {
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          top: rect.top,
        };
      };
      const measure = getComputedStyle(panel)
        .getPropertyValue("--form-measure")
        .trim();
      const rootFontPx = Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      return {
        column: box(column),
        measurePx: measure.endsWith("rem")
          ? Number.parseFloat(measure) * rootFontPx
          : null,
        panel: box(panel),
        region: box(region),
      };
    }, regionSelector),
  );
}

function expectFills(geometry: TakeoverGeometry, label: string): void {
  const { panel, region } = geometry;
  expect(panel.left, `${label} left`).toBeCloseTo(region.left, 0);
  expect(panel.right, `${label} right`).toBeCloseTo(region.right, 0);
  expect(panel.top, `${label} top`).toBeCloseTo(region.top, 0);
  expect(panel.bottom, `${label} bottom`).toBeCloseTo(region.bottom, 0);
}

function expectCenteredColumn(geometry: TakeoverGeometry, label: string): void {
  const { column, measurePx, panel } = geometry;
  const width = column.right - column.left;
  expect(
    column.left - panel.left,
    `${label}: the column sits centered`,
  ).toBeCloseTo(panel.right - column.right, 0);
  if (measurePx !== null) {
    expect(width, `${label}: the column keeps the measure`).toBeLessThanOrEqual(
      measurePx + 0.5,
    );
  }
}

async function openResetDevice(page: Page): Promise<Locator> {
  const reset = page.getByRole("button", { name: "Reset Device" });
  await expect(reset).toBeVisible({ timeout: 30_000 });
  await reset.click();
  const dialog = page.getByRole("dialog", { name: "Reset this device" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openCreateFolder(page: Page): Promise<Locator> {
  const create = page.getByRole("button", {
    name: "Create Child Folder",
    exact: true,
  });
  await expect(create).toBeEnabled({ timeout: 30_000 });
  await create.click();
  const dialog = page.getByRole("dialog", { name: "Create Child Folder" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("a phone confirmation takes over the whole screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/identity-manager/local-data");
  const dialog = await openResetDevice(page);

  const geometry = await readTakeover(dialog, ".routed-pane");
  expectFills(geometry, "Reset Device");
  expect(geometry.region.right - geometry.region.left).toBeCloseTo(390, 0);
  expect(geometry.region.bottom - geometry.region.top).toBeCloseTo(844, 0);
  expectCenteredColumn(geometry, "Reset Device");
});

test("a phone prompt takes over the main pane under the app bar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/explorer");
  const dialog = await openCreateFolder(page);

  const geometry = await readTakeover(dialog, ".routed-pane-main");
  expectFills(geometry, "Create Child Folder");
  expectCenteredColumn(geometry, "Create Child Folder");
});

test("a windowed prompt takes over the window's whole content section", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app/explorer");
  await switchToWindowedDesktop(page);
  const dialog = await openCreateFolder(page);

  // The section, not the mini-app root inside the body's padding: the item
  // list runs through that padding to the window's edges, and a takeover that
  // stopped short of it left the list's rules showing around the dialog.
  const geometry = await readTakeover(dialog, ".window-body-content");
  expectFills(geometry, "Create Child Folder");
  expectCenteredColumn(geometry, "Create Child Folder");
  expect(geometry.measurePx).not.toBeNull();
});

test("a confirmation taller than the screen scrolls from its title", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 300 });
  await page.goto("/app/identity-manager/local-data");
  const dialog = await openResetDevice(page);

  const overflow = await dialog.evaluate((panel) => ({
    clientHeight: panel.clientHeight,
    scrollHeight: panel.scrollHeight,
    scrollTop: panel.scrollTop,
  }));
  expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);
  expect(overflow.scrollTop).toBe(0);

  // Centered content that overflows would start above the scrollport, where
  // no scroll can reach it.
  const panelBox = await dialog.boundingBox();
  const titleBox = await dialog
    .getByRole("heading", { name: "Reset this device" })
    .boundingBox();
  if (!panelBox || !titleBox) {
    throw new Error("The dialog or its title did not render.");
  }
  expect(titleBox.y).toBeGreaterThanOrEqual(panelBox.y);

  await dialog.getByRole("button", { name: "Cancel" }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeInViewport();
});
