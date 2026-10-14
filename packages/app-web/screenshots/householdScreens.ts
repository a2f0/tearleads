import { expect, type Locator, type Page } from "@playwright/test";
import {
  type DocumentExpectation,
  type EquipmentExpectation,
  seedExpectations,
  type TrackerExpectation,
} from "./continuity";
import { openDocumentImage } from "./documentImages";
import { assertImagesDecoded } from "./imageReadiness";

async function openExplorerDocument(
  scope: Page | Locator,
  title: string,
): Promise<void> {
  const row = scope.locator(".explorer-item-row-button", { hasText: title });
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  await row.click();
}

function photoDetail(expected: DocumentExpectation) {
  return async (scope: Page | Locator) => {
    await openExplorerDocument(scope, expected.title);
    await assertImagesDecoded(
      scope.locator("img.file-document-media-preview"),
      expected.imageCount,
    );
  };
}

function equipmentDetail(expected: EquipmentExpectation) {
  return async (scope: Page | Locator) => {
    await openExplorerDocument(scope, expected.title);
    for (const value of [
      expected.fields.make,
      expected.fields.model,
      expected.fields.serialNumber,
    ]) {
      await expect(
        scope
          .locator(".structured-document-read-fields")
          .getByText(value, { exact: true }),
      ).toBeVisible();
    }
    await assertImagesDecoded(
      scope.locator("img.structured-document-slot-preview-image"),
      expected.imageCount,
    );
  };
}

function trackerDetail(
  expected: TrackerExpectation,
  kind: "weight" | "bloodPressure",
) {
  return async (scope: Page | Locator) => {
    await openExplorerDocument(scope, expected.title);
    const charts =
      kind === "weight"
        ? [...new Set(expected.rows.map(({ unit }) => unit))].map((unit) => ({
            name: `Weight over time (${unit})`,
            points: expected.rows.filter(
              ({ unit: rowUnit }) => rowUnit === unit,
            ).length,
          }))
        : [{ name: "Blood pressure over time", points: expected.rowCount * 2 }];
    for (const { name, points } of charts) {
      const chart = scope.getByRole("img", { name, exact: true });
      await expect(chart).toBeVisible({ timeout: 20_000 });
      await expect(chart.locator("circle")).toHaveCount(points);
    }
    const table = scope.getByRole("table", {
      name: kind === "weight" ? "Entries" : "Readings",
      exact: true,
    });
    await expect(table.locator("tbody tr")).toHaveCount(expected.rowCount);
    for (const { weight, unit, systolic, diastolic } of expected.rows) {
      await expect(
        table
          .getByText(
            kind === "weight"
              ? `${weight} ${unit}`
              : `${systolic}/${diastolic} mmHg`,
            { exact: true },
          )
          .first(),
      ).toBeAttached();
    }
  };
}

export const HOUSEHOLD_SCREENS = [
  ...seedExpectations.photos.map((expected, index) => ({
    name: `family-photo-${index + 1}`,
    open: photoDetail(expected),
  })),
  ...seedExpectations.tools.map((expected, index) => ({
    name: `tool-detail-${index + 1}`,
    open: equipmentDetail(expected),
  })),
  ...seedExpectations.appliances.map((expected, index) => ({
    name: `appliance-detail-${index + 1}`,
    open: equipmentDetail(expected),
  })),
  ...[
    { name: "tool-receipt", expected: seedExpectations.tools[0] },
    { name: "appliance-receipt", expected: seedExpectations.appliances[0] },
  ].map(({ name, expected }) => {
    if (!expected) throw new Error(`Missing receipt capture fixture: ${name}`);
    return { name, open: openDocumentImage(expected, "Receipt Image") };
  }),
  {
    name: "weight-detail",
    open: trackerDetail(seedExpectations.weight, "weight"),
  },
  {
    name: "blood-pressure-detail",
    open: trackerDetail(seedExpectations.bloodPressure, "bloodPressure"),
  },
].map((screen) => ({
  ...screen,
  route: "/app/explorer",
  menuLabel: "Explorer",
}));
