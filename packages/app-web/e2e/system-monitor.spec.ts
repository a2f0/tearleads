import { expect, type Locator, type Page, test } from "@playwright/test";

function visiblePane(page: Page): Locator {
  return page.locator(".pane:not(.pane-hidden)").first();
}

async function showSystemMonitorTab(
  pane: Locator,
  tabName: "Environment" | "Status",
): Promise<void> {
  if ((await pane.getByRole("tab", { name: "Logs" }).count()) === 0) {
    await pane.getByRole("button", { name: "System Monitor" }).click();
  }

  const tab = pane.getByRole("tab", { name: tabName });
  await expect(tab).toBeVisible();
  if ((await tab.getAttribute("aria-selected")) !== "true") {
    await tab.click();
  }
}

// The Environment and Status tabs wrap their tables in `.pane-content`, whose
// `overflow: hidden` suits the desktop pane but used to clip the monitor's tab
// content: the tab panel scroller never overflowed, so a window shorter than
// the table could not scroll to the remaining rows. DOM tests cannot see that
// clipping — only a real layout can — so shrink the window well below both
// tables' heights and confirm each tab's panel scrolls its last row into view.
test("a short System Monitor window scrolls its table tabs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");

  const pane = visiblePane(page);
  await expect(pane).toBeVisible({ timeout: 30_000 });
  await showSystemMonitorTab(pane, "Environment");

  const monitorWindow = pane.locator(".window").first();
  const panel = monitorWindow.locator(".system-monitor-tab-panel");
  await expect(
    panel.locator(".system-monitor-environment-table tr").first(),
  ).toBeVisible();

  // Drag the bottom-right resize handle to shrink the window to ~260px tall,
  // leaving the tab panel far shorter than either tab's table.
  const windowBox = await monitorWindow.boundingBox();
  const handleBox = await monitorWindow
    .locator(".window-resize--se")
    .boundingBox();
  if (!windowBox || !handleBox) {
    throw new Error("Expected the monitor window and resize handle to render.");
  }
  const handleX = handleBox.x + handleBox.width / 2;
  const handleY = handleBox.y + handleBox.height / 2;
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await page.mouse.move(handleX, handleY - (windowBox.height - 260), {
    steps: 8,
  });
  await page.mouse.up();

  for (const tabName of ["Environment", "Status"] as const) {
    await showSystemMonitorTab(pane, tabName);
    await expect
      .poll(
        () =>
          panel.evaluate(
            (element) => element.scrollHeight - element.clientHeight,
          ),
        { message: `${tabName} panel should overflow the short window` },
      )
      .toBeGreaterThan(0);

    // Scroll to the bottom and require the table's last row to land fully
    // inside the panel's box — the clipped layout could never reach it.
    const lastRowInView = await panel.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      const rows = element.querySelectorAll(".mini-app-info-table tr");
      const lastRow = rows[rows.length - 1];
      if (!lastRow) {
        return false;
      }
      const panelRect = element.getBoundingClientRect();
      const rowRect = lastRow.getBoundingClientRect();
      return (
        rowRect.top >= panelRect.top && rowRect.bottom <= panelRect.bottom + 1
      );
    });
    expect(lastRowInView, `${tabName} last row scrolls into view`).toBe(true);
  }
});
