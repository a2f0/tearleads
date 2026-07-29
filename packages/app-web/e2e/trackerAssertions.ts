import { expect, type Locator } from "@playwright/test";

export async function expectWindowedInputClamps(
  scope: Locator,
  inputs: ReadonlyArray<readonly [label: string, capRem: number]>,
): Promise<void> {
  for (const [label, expectedCap] of inputs) {
    const input = scope.getByLabel(label);
    await expect(input).toBeVisible();
    const geometry = await input.evaluate((element) => {
      const rawMaxWidth = getComputedStyle(element).maxWidth;
      return {
        maxWidth: rawMaxWidth.endsWith("px")
          ? Number.parseFloat(rawMaxWidth)
          : null,
        parentWidth: element.parentElement?.getBoundingClientRect().width ?? 0,
        rootFontSize: Number.parseFloat(
          getComputedStyle(document.documentElement).fontSize,
        ),
        width: element.getBoundingClientRect().width,
      };
    });

    expect(geometry.maxWidth).toBe(expectedCap * geometry.rootFontSize);
    expect(geometry.parentWidth).toBeGreaterThan(geometry.maxWidth ?? 0);
    expect(geometry.width).toBeCloseTo(geometry.maxWidth ?? 0, 0);
  }
}

export async function expectActionBelowField(
  scope: Locator,
  fieldLabel: string,
  actionLabel: string,
): Promise<void> {
  const field = scope.getByLabel(fieldLabel, { exact: true });
  const action = scope.getByRole("button", { name: actionLabel });
  await expect(field).toBeVisible();
  await expect(action).toBeVisible();
  const fieldBox = await field.boundingBox();
  const actionBox = await action.boundingBox();
  if (!fieldBox || !actionBox) {
    throw new Error(`Could not measure ${fieldLabel} and ${actionLabel}`);
  }

  expect(actionBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height);
}
