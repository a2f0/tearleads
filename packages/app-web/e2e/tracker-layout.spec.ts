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

async function expectActionsShareRow(
  actions: Locator,
  saveLabel: string,
  removeLabel: string,
): Promise<void> {
  const save = actions.getByRole("button", { name: saveLabel });
  const remove = actions.getByRole("button", { name: removeLabel });
  await expect(save).toBeVisible();
  await expect(remove).toBeVisible();
  const saveBox = await save.boundingBox();
  const removeBox = await remove.boundingBox();
  if (!saveBox || !removeBox) {
    throw new Error("Expected visible tracker action geometry.");
  }
  expect(saveBox.y).toBeCloseTo(removeBox.y, 0);
  expect(saveBox.x + saveBox.width).toBeLessThanOrEqual(removeBox.x);
}

test("windowed health trackers share compact fields and finish actions", async ({
  page,
}) => {
  const { explorerWindow, toolbar } = await openExplorerWindow(page);

  await createTracker(explorerWindow, toolbar, "Blood Pressure");
  await explorerWindow.getByRole("button", { name: "Add Reading" }).click();
  await expect(
    explorerWindow.getByRole("button", { name: "Add Reading" }),
  ).toHaveCount(0);
  await expectWindowedInputClamps(explorerWindow, [
    ["Quick add systolic", 7],
    ["Quick add diastolic", 7],
    ["Quick add pulse", 7],
    ["Quick add measured at", 14],
  ]);
  await explorerWindow.getByLabel("Quick add systolic").fill("120");
  await explorerWindow.getByLabel("Quick add diastolic").fill("80");
  await explorerWindow.getByRole("button", { name: "Save Reading" }).click();
  await expectActionBelowField(
    explorerWindow,
    "Reading 1 notes",
    "Remove reading 1",
  );
  const readingActions = explorerWindow
    .getByLabel("Reading 1 systolic")
    .locator("../..")
    .locator(".tracker-row-actions");
  await expectActionsShareRow(
    readingActions,
    "Save reading 1",
    "Remove reading 1",
  );
  await readingActions.getByRole("button", { name: "Save reading 1" }).click();
  await expect(toolbar.getByRole("button", { name: "Edit" })).toBeVisible();

  await toolbar.getByRole("button", { name: "Back" }).click();
  await createTracker(explorerWindow, toolbar, "Weight");
  await explorerWindow.getByRole("button", { name: "Add Entry" }).click();
  await expect(
    explorerWindow.getByRole("button", { name: "Add Entry" }),
  ).toHaveCount(0);
  await expectWindowedInputClamps(explorerWindow, [
    ["Quick add weight", 7],
    ["Quick add measured at", 14],
  ]);
  await explorerWindow.getByLabel("Quick add weight").fill("180");
  await explorerWindow.getByRole("button", { name: "Save Entry" }).click();
  await expectActionBelowField(
    explorerWindow,
    "Entry 1 notes",
    "Remove entry 1",
  );
  const entryActions = explorerWindow
    .getByLabel("Entry 1 weight")
    .locator("../..")
    .locator(".tracker-row-actions");
  await expectActionsShareRow(entryActions, "Save entry 1", "Remove entry 1");
  await entryActions.getByRole("button", { name: "Save entry 1" }).click();
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
  await expect(page.getByRole("button", { name: "Add Entry" })).toHaveCount(0);
  await page.getByLabel("Quick add weight").fill("180");
  await page.getByRole("button", { name: "Save Entry" }).click();

  const row = page.locator(".weight-entry-row").first();
  const rowActions = row.locator(".tracker-row-actions");
  await expectActionBelowField(row, "Entry 1 notes", "Remove entry 1");
  await expectActionsShareRow(rowActions, "Save entry 1", "Remove entry 1");
});
