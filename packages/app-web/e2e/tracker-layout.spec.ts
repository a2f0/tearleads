import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  expectActionBelowField,
  expectWindowedInputClamps,
} from "./trackerAssertions";

function visiblePane(page: Page): Locator {
  return page.locator(".pane:not(.pane-hidden)").first();
}

async function openExplorerWindow(page: Page): Promise<{
  explorerWindow: Locator;
  toolbar: Locator;
}> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");

  const pane = visiblePane(page);
  await expect(pane).toBeVisible({ timeout: 30_000 });
  await pane.click({ button: "right", position: { x: 120, y: 120 } });
  await page.getByRole("button", { name: "Explorer" }).first().click();

  const explorerWindow = page.locator(".window").first();
  const toolbar = explorerWindow.locator(".window-toolbar");
  await expect(
    toolbar.getByRole("button", { name: "New Document" }),
  ).toBeVisible({ timeout: 30_000 });
  return { explorerWindow, toolbar };
}

async function createTracker(
  explorerWindow: Locator,
  toolbar: Locator,
  type: "Blood Pressure" | "Weight",
): Promise<void> {
  await toolbar.getByRole("button", { name: "New Document" }).click();
  await explorerWindow
    .getByRole("button", { name: new RegExp(type, "u") })
    .first()
    .click();
  await expect(toolbar.getByRole("button", { name: "Save" })).toBeVisible();
}

async function expectButtonFillsContainer(
  button: Locator,
  container: Locator,
): Promise<void> {
  await expect(button).toBeVisible();
  const buttonBox = await button.boundingBox();
  const containerBox = await container.boundingBox();
  if (!buttonBox || !containerBox) {
    throw new Error("Expected visible tracker action geometry.");
  }
  expect(buttonBox.width).toBeCloseTo(containerBox.width, 0);
}

test("windowed health trackers share compact fields and finish actions", async ({
  page,
}) => {
  const { explorerWindow, toolbar } = await openExplorerWindow(page);

  await createTracker(explorerWindow, toolbar, "Blood Pressure");
  await explorerWindow.getByRole("button", { name: "Add Reading" }).click();
  await expectWindowedInputClamps(explorerWindow, [
    ["Reading 1 systolic", 7],
    ["Reading 1 diastolic", 7],
    ["Reading 1 pulse", 7],
    ["Reading 1 measured at", 14],
  ]);
  await expectActionBelowField(
    explorerWindow,
    "Reading 1 notes",
    "Remove reading 1",
  );
  await explorerWindow
    .locator(".tracker-save-actions")
    .getByRole("button", { name: "Save" })
    .click();
  await expect(toolbar.getByRole("button", { name: "Edit" })).toBeVisible();

  await toolbar.getByRole("button", { name: "Back" }).click();
  await createTracker(explorerWindow, toolbar, "Weight");
  await explorerWindow.getByRole("button", { name: "Add Entry" }).click();
  await expectWindowedInputClamps(explorerWindow, [
    ["Entry 1 weight", 7],
    ["Entry 1 measured at", 14],
  ]);
  await expectActionBelowField(
    explorerWindow,
    "Entry 1 notes",
    "Remove entry 1",
  );
  await explorerWindow
    .locator(".tracker-save-actions")
    .getByRole("button", { name: "Save" })
    .click();
  await expect(toolbar.getByRole("button", { name: "Edit" })).toBeVisible();
});

test("mobile tracker actions span their rows", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/explorer");

  const newDocument = page.getByRole("button", { name: "New Document" });
  await expect(newDocument).toBeVisible({ timeout: 30_000 });
  await newDocument.click();
  await page
    .getByRole("button", { name: /Weight/u })
    .first()
    .click();
  await page.getByRole("button", { name: "Add Entry" }).click();

  const row = page.locator(".weight-entry-row").first();
  const rowActions = row.locator(".tracker-row-actions");
  const remove = rowActions.getByRole("button", { name: "Remove entry 1" });
  await expectActionBelowField(row, "Entry 1 notes", "Remove entry 1");
  await expectButtonFillsContainer(remove, rowActions);

  const saveActions = page.locator(".tracker-save-actions");
  await expectButtonFillsContainer(
    saveActions.getByRole("button", { name: "Save" }),
    saveActions,
  );
});
