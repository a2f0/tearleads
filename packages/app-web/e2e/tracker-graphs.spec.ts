import { expect, test } from "@playwright/test";

for (const kind of ["Weight", "Blood Pressure"] as const) {
  test(`${kind} graph fits phone and tablet widths and plots dated readings`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app/explorer");
    const newDocument = page.getByRole("button", { name: "New Document" });
    await expect(newDocument).toBeVisible({ timeout: 30_000 });
    await newDocument.click();
    await page
      .getByRole("button", { name: new RegExp(kind, "u") })
      .first()
      .click();
    for (const [index, date] of [
      "2026-07-16T08:00",
      "2026-07-17T08:00",
      "2026-07-20T08:00",
    ].entries()) {
      const weight = kind === "Weight";
      const add = page.getByRole("button", {
        name: weight ? "Add Entry" : "Add Reading",
      });
      await add.click();
      if (weight) {
        await page.getByLabel("Quick add weight").fill(String(180 - index));
      } else {
        await page
          .getByLabel("Quick add systolic")
          .fill(String(120 - index * 2));
        await page.getByLabel("Quick add diastolic").fill(String(80 - index));
        await page.getByLabel("Quick add pulse").fill(String(72 - index));
      }
      await page.getByLabel("Quick add measured at").fill(date);
      await page
        .getByRole("button", {
          exact: true,
          name: weight ? "Save Entry" : "Save Reading",
        })
        .click();
      await expect(add).toBeVisible();
    }
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const chart = page.getByRole("img", {
      name:
        kind === "Weight"
          ? "Weight over time (lb)"
          : "Blood pressure over time",
    });
    await expect(chart).toBeVisible();
    await expect(chart.locator("circle")).toHaveCount(
      kind === "Weight" ? 3 : 6,
    );
    for (const width of [390, 900]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect
        .poll(async () =>
          chart.evaluate((element) => {
            const viewport = element.parentElement;
            return viewport ? viewport.scrollWidth - viewport.clientWidth : 999;
          }),
        )
        .toBeLessThanOrEqual(1);
      // Labels keep their readable size as the viewBox follows the actual pane.
      await expect
        .poll(async () =>
          chart.evaluate((element) => {
            const svg = element as SVGSVGElement;
            return Math.abs(
              svg.viewBox.baseVal.width - svg.getBoundingClientRect().width,
            );
          }),
        )
        .toBeLessThanOrEqual(1);
      const points = await chart
        .locator("g.time-series-graph-series")
        .first()
        .locator("circle")
        .evaluateAll((elements) =>
          elements.map((element) => Number(element.getAttribute("cx"))),
        );
      const [first = 0, middle = 0, last = 0] = points;
      expect((middle - first) / (last - first)).toBeCloseTo(0.25);
      await page
        .locator(".time-series-graph")
        .first()
        .screenshot({ path: testInfo.outputPath(`graph-${width}.png`) });
    }
  });
}
