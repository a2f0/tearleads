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
  type: ".env File" | "Blood Pressure" | "Weight",
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

async function expectActionsFillRow(actions: Locator): Promise<void> {
  const actionBox = await actions.boundingBox();
  const buttons = actions.getByRole("button");
  const saveBox = await buttons.first().boundingBox();
  const removeBox = await buttons.last().boundingBox();
  if (!actionBox || !saveBox || !removeBox) {
    throw new Error("Expected visible tracker action geometry.");
  }
  expect(Math.abs(saveBox.x - actionBox.x)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(removeBox.x + removeBox.width - (actionBox.x + actionBox.width)),
  ).toBeLessThanOrEqual(1);
  expect(Math.abs(saveBox.width - removeBox.width)).toBeLessThanOrEqual(1);
}

async function checkWindowedBloodPressure(
  explorerWindow: Locator,
  toolbar: Locator,
) {
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
    .locator(".blood-pressure-reading-row")
    .locator(".tracker-row-actions");
  await expectActionsShareRow(
    readingActions,
    "Save reading 1",
    "Remove reading 1",
  );
  await readingActions.getByRole("button", { name: "Save reading 1" }).click();
  await expect(
    explorerWindow.locator(".blood-pressure-reading-read-row"),
  ).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Save" })).toBeVisible();
  await toolbar.getByRole("button", { name: "Save" }).click();
  await expect(toolbar.getByRole("button", { name: "Edit" })).toBeVisible();
}

async function checkWindowedWeight(explorerWindow: Locator, toolbar: Locator) {
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
    .locator(".weight-entry-row")
    .locator(".tracker-row-actions");
  await expectActionsShareRow(entryActions, "Save entry 1", "Remove entry 1");
  await entryActions.getByRole("button", { name: "Save entry 1" }).click();
  await expect(explorerWindow.locator(".weight-entry-read-row")).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Save" })).toBeVisible();
  await toolbar.getByRole("button", { name: "Save" }).click();
  await expect(toolbar.getByRole("button", { name: "Edit" })).toBeVisible();
}

async function checkWindowedEnvFile(explorerWindow: Locator, toolbar: Locator) {
  await toolbar.getByRole("button", { name: "Back" }).click();
  await createTracker(explorerWindow, toolbar, ".env File");
  await explorerWindow.getByRole("button", { name: "Add Variable" }).click();
  await expect(
    explorerWindow.getByRole("button", { name: "Add Variable" }),
  ).toHaveCount(0);
  await explorerWindow.getByLabel("Quick add env variable key").fill("API_URL");
  await explorerWindow
    .getByLabel("Quick add env variable value")
    .fill("https://example.test");
  await explorerWindow.getByRole("button", { name: "Save Variable" }).click();
  await expectActionBelowField(
    explorerWindow,
    "Env variable 1 value",
    "Remove env variable 1",
  );
  const variableActions = explorerWindow
    .locator(".env-file-variable-row")
    .locator(".tracker-row-actions");
  await expectActionsShareRow(
    variableActions,
    "Save env variable 1",
    "Remove env variable 1",
  );
  await variableActions
    .getByRole("button", { name: "Save env variable 1" })
    .click();
  await expect(
    explorerWindow.locator(".env-file-variable-read-row"),
  ).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Save" })).toBeVisible();
}

test("windowed health trackers share compact fields and finish actions", async ({
  page,
}) => {
  const { explorerWindow, toolbar } = await openExplorerWindow(page);
  await checkWindowedBloodPressure(explorerWindow, toolbar);
  await checkWindowedWeight(explorerWindow, toolbar);
  await checkWindowedEnvFile(explorerWindow, toolbar);
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
  await expectActionsFillRow(rowActions);
});

test("mobile env variable actions span their row", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/explorer");

  const newDocument = page.getByRole("button", { name: "New Document" });
  await expect(newDocument).toBeVisible({ timeout: 30_000 });
  await newDocument.click();
  await page
    .getByRole("button", { name: /\.env File/u })
    .first()
    .click();
  await page.getByRole("button", { name: "Add Variable" }).click();
  await expect(page.getByRole("button", { name: "Add Variable" })).toHaveCount(
    0,
  );
  await page.getByLabel("Quick add env variable key").fill("API_TOKEN");
  await page.getByRole("button", { name: "Save Variable" }).click();

  const row = page.locator(".env-file-variable-row").first();
  const rowActions = row.locator(".tracker-row-actions");
  await expectActionBelowField(
    row,
    "Env variable 1 value",
    "Remove env variable 1",
  );
  await expectActionsShareRow(
    rowActions,
    "Save env variable 1",
    "Remove env variable 1",
  );
  await expectActionsFillRow(rowActions);
});
