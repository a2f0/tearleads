import { expect, type Locator, type Page, test } from "@playwright/test";

const SQLITE_READY_PATTERN = /SQLite Worker:\s*ready/u;
const PUBLIC_KEY_PATTERN = /Public Key:\s*([0-9a-f]{64})/u;

function visiblePane(page: Page, side?: "left" | "right"): Locator {
  const sideClass = side ? `.pane-${side}` : "";
  return page.locator(`${sideClass}.pane:not(.pane-hidden)`).first();
}

async function generateKeyPair(page: Page, pane: Locator): Promise<void> {
  if (await waitForPanePublicKey(pane, 2_000)) {
    return;
  }

  await pane.getByRole("button", { name: "Menu" }).click();
  const generatedKeyAction = page
    .getByRole("button", {
      name: "Destroy Key Pair",
    })
    .first();
  if (await generatedKeyAction.isVisible().catch(() => false)) {
    return;
  }

  const generateKeyAction = page
    .getByRole("button", {
      name: "Generate Key Pair",
    })
    .first();
  try {
    await generateKeyAction.click({ timeout: 5_000 });
  } catch (error) {
    if (await waitForPanePublicKey(pane, 5_000)) {
      return;
    }
    if (await generatedKeyAction.isVisible().catch(() => false)) {
      return;
    }
    throw error;
  }
}

async function paneHasPublicKey(pane: Locator): Promise<boolean> {
  return PUBLIC_KEY_PATTERN.test(await paneStatusText(pane));
}

async function waitForPanePublicKey(
  pane: Locator,
  timeout: number,
): Promise<boolean> {
  try {
    await expect.poll(() => paneHasPublicKey(pane), { timeout }).toBe(true);
    return true;
  } catch {
    return false;
  }
}

async function enableDeveloperMode(page: Page, pane: Locator): Promise<void> {
  await showSystemMonitorTab(pane, "Logs");
  await page.getByRole("menuitem", { name: "View" }).click();
  const enableAction = page.getByRole("menuitem", {
    name: "Enable Developer Mode",
  });
  try {
    await enableAction.waitFor({ state: "visible", timeout: 1_000 });
    await enableAction.click();
    return;
  } catch {
    await page.keyboard.press("Escape");
  }
}

async function killWorker(page: Page, pane: Locator): Promise<void> {
  await enableDeveloperMode(page, pane);
  const navigationModeSwitch = page.getByRole("button", {
    name: "Switch to iPad / mobile layout",
  });
  await navigationModeSwitch.click();
  await expect(page.locator(".routed-pane")).toBeVisible();
  // The routed nav rail defaults to collapsed; open it to reach the developer
  // "Kill Worker" action that lives in its system menu.
  await page.getByRole("button", { name: "Expand navigation rail" }).click();
  await page.getByRole("button", { name: "Kill Worker" }).click();
}

async function showSystemMonitorTab(
  pane: Locator,
  tabName: "Environment" | "Logs" | "Status",
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

async function paneStatus(pane: Locator): Promise<Locator> {
  await showSystemMonitorTab(pane, "Status");
  return pane.locator(".pane-content").first();
}

// The status pane renders a MiniAppInfoTable (bold label cell + value cell), so
// flatten each row back to a "label: value" line for the text-based patterns.
async function paneStatusText(pane: Locator): Promise<string> {
  const status = await paneStatus(pane);
  return status.evaluate((element) => {
    const rows = element.querySelectorAll(".mini-app-info-table tr");
    if (rows.length === 0) {
      return element.textContent ?? "";
    }
    return Array.from(rows)
      .map((row) => {
        const label = row.querySelector("th")?.textContent?.trim() ?? "";
        const value = row.querySelector("td")?.textContent?.trim() ?? "";
        return `${label}: ${value}`;
      })
      .join("\n");
  });
}

async function paneLogs(pane: Locator): Promise<Locator> {
  await showSystemMonitorTab(pane, "Logs");
  return pane.locator(".pane-log").first();
}

async function waitForPaneBooted(pane: Locator): Promise<void> {
  await expect
    .poll(() => paneStatusText(pane), { timeout: 30_000 })
    .toMatch(SQLITE_READY_PATTERN);
  await expect
    .poll(() => paneStatusText(pane), { timeout: 30_000 })
    .toMatch(PUBLIC_KEY_PATTERN);
}

async function panePublicKey(pane: Locator): Promise<string> {
  const statusText = await paneStatusText(pane);
  const match = PUBLIC_KEY_PATTERN.exec(statusText);
  if (!match?.[1]) {
    throw new Error(`Pane status did not include a public key: ${statusText}`);
  }
  return match[1];
}

test("page loads", async ({ page }) => {
  const sqliteWarnings: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("Ignoring inability to install OPFS sqlite3_vfs:")) {
      sqliteWarnings.push(text);
    }
  });

  await page.goto("/");

  await expect(page).toHaveTitle("App");
  const firstVisiblePane = visiblePane(page);
  await generateKeyPair(page, firstVisiblePane);

  await waitForPaneBooted(firstVisiblePane);
  expect(sqliteWarnings).toEqual([]);
});

test("mobile sidebar covers Explorer rows", async ({ page }) => {
  await page.setViewportSize({ width: 599, height: 800 });
  await page.goto("/app/explorer");

  const rowAction = page.getByRole("button", { name: "Actions for Contacts" });
  await expect(rowAction).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Show Sidebar" }).click();
  const sidebar = page.getByRole("dialog");
  await expect(sidebar).toBeVisible();

  const actionBox = await rowAction.boundingBox();
  const sidebarBox = await sidebar.boundingBox();
  if (!actionBox || !sidebarBox) {
    throw new Error("Expected visible Explorer action and sidebar boxes.");
  }
  // The drawer opens on the leading edge, so it covers the row's own start while
  // the scrim covers the trailing row action. Both shell layers must paint over
  // main content rather than letting its local z-indices show through.
  expect(sidebarBox.x).toBe(0);
  const rowMiddleY = actionBox.y + actionBox.height / 2;
  const underDrawer = { x: sidebarBox.x + sidebarBox.width / 2, y: rowMiddleY };
  const actionCenter = { x: actionBox.x + actionBox.width / 2, y: rowMiddleY };
  expect(actionCenter.x).toBeGreaterThan(sidebarBox.x + sidebarBox.width);
  expect(rowMiddleY).toBeGreaterThan(sidebarBox.y);
  expect(rowMiddleY).toBeLessThan(sidebarBox.y + sidebarBox.height);

  const coverage = await page.evaluate(
    (points) =>
      points.map(({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        if (element?.closest("#routed-pane-sidebar")) {
          return "drawer";
        }
        return element?.closest(".routed-pane-scrim") ? "scrim" : "content";
      }),
    [underDrawer, actionCenter],
  );

  expect(coverage).toEqual(["drawer", "scrim"]);
});

// Growing the hit target is only half of the HIG rule, and it is the half that
// measures clean while still looking wrong: a 44px button around an 18px glyph
// reads as a tiny mark on a phone. The icons carry `size={18}` as an attribute
// and the routed tier re-sizes them in CSS, which is exactly the kind of
// override a refactor drops silently — so assert the drawn box, not the prop.
test("mobile app bar draws its icons at the touch glyph size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 599, height: 800 });
  await page.goto("/app/explorer");

  const sidebarToggle = page.getByRole("button", { name: "Show Sidebar" });
  await expect(sidebarToggle).toBeVisible({ timeout: 30_000 });

  const buttonBox = await sidebarToggle.boundingBox();
  const glyphBox = await sidebarToggle.locator("svg").boundingBox();
  if (!buttonBox || !glyphBox) {
    throw new Error("Expected a visible app bar button and its icon.");
  }

  expect(buttonBox.height).toBeGreaterThanOrEqual(44);
  expect(buttonBox.width).toBeGreaterThanOrEqual(44);
  expect(glyphBox.width).toBeGreaterThanOrEqual(24);
  expect(glyphBox.height).toBeGreaterThanOrEqual(24);
});

// A tab strip is chrome, so on a phone it spans the screen rather than sitting
// inset like content — otherwise its baseline (which reads as the panel's top
// edge) stops short of both sides and the strip floats as a card. The bleed in
// MiniAppTabs.css cancels exactly the `--space-md` that `.mini-app-root` applies,
// which only holds while every tabbed surface sits directly in that root. Assert
// the drawn box on two surfaces that reach the strip by different routes — a
// future strip nested inside extra inline padding would overshoot instead, so
// also assert the page did not gain horizontal overflow.
for (const surface of [
  { path: "/app/system-monitor", tab: "Logs" },
  { path: "/app/explorer/blobs", tab: "Blob Browser" },
]) {
  test(`mobile tab strip bleeds to both screen edges (${surface.path})`, async ({
    page,
  }) => {
    const viewportWidth = 599;
    await page.setViewportSize({ width: viewportWidth, height: 800 });
    await page.goto(surface.path);

    await expect(page.getByRole("tab", { name: surface.tab })).toBeVisible({
      timeout: 30_000,
    });

    const stripBox = await page.locator(".mini-app-tabs").first().boundingBox();
    if (!stripBox) {
      throw new Error(`Expected a visible tab strip on ${surface.path}.`);
    }

    expect(stripBox.x).toBe(0);
    expect(stripBox.width).toBe(viewportWidth);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(viewportWidth);
  });
}

// Regression coverage for the mobile Get Info back loop: Explorer used to
// register a "Back to Document" action on the routed app bar, which PUSHED the
// document route instead of popping the info route. The document route
// registers no override, so its Back popped straight back into Get Info and the
// two alternated forever — the Explorer list was unreachable.
test("mobile Back unwinds out of a document's Get Info", async ({ page }) => {
  await page.setViewportSize({ width: 599, height: 800 });
  await page.goto("/app/explorer");

  await expect(
    page.getByRole("button", { name: "Actions for Contacts" }),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "New Document" }).click();
  await page
    .getByRole("button", { name: /Blood Pressure/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/app\/explorer\/items\/[0-9a-f-]+$/u);
  const documentUrl = page.url();

  await page.getByRole("button", { name: "Get Info" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+\/info$/u);

  const back = page
    .locator(".routed-pane-history-controls")
    .getByRole("button", { name: "Back" });

  // Each press must unwind one entry: info -> document -> the Explorer list.
  await back.click();
  await expect(page).toHaveURL(documentUrl);
  await back.click();
  await expect(page).toHaveURL(/\/app\/explorer$/u);
  await expect(back).toBeDisabled();
});

// Windows are not backed by browser history, so the windowed toolbar's Back
// caret walks the window's own route stack (WindowEntry.miniAppRouteHistory).
// It must unwind one entry per press, exactly like the routed app bar — and the
// transient type picker must not become a Back destination.
test("windowed Back unwinds an Explorer window's route stack", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");

  const pane = visiblePane(page);
  await expect(pane).toBeVisible({ timeout: 30_000 });
  await pane.click({ button: "right", position: { x: 120, y: 120 } });
  await page.getByRole("button", { name: "Explorer" }).first().click();

  const explorerWindow = page.locator(".window").first();
  const toolbar = explorerWindow.locator(".window-toolbar");
  const back = toolbar.getByRole("button", { name: "Back" });

  // The caret is present from the first route, disabled rather than absent, so
  // it does not appear and disappear as the stack empties and refills.
  await expect(
    toolbar.getByRole("button", { name: "New Document" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(back).toBeDisabled();

  await toolbar.getByRole("button", { name: "New Document" }).click();
  await explorerWindow
    .getByRole("button", { name: /Blood Pressure/ })
    .first()
    .click();
  // A freshly created document opens in edit mode, so its toolbar carries Done.
  await expect(toolbar.getByRole("button", { name: "Done" })).toBeVisible();

  await toolbar.getByRole("button", { name: "Get Info" }).click();
  await expect(toolbar.getByRole("button", { name: "Done" })).toBeHidden();
  await expect(back).toBeEnabled();

  // Back to the document (returning in read mode, so Edit rather than Done)...
  await back.click();
  await expect(toolbar.getByRole("button", { name: "Edit" })).toBeVisible();

  // ...then straight to the container listing, skipping the replaced type
  // picker, with the stack now empty.
  await back.click();
  await expect(
    toolbar.getByRole("button", { name: "Create Child Folder" }),
  ).toBeVisible();
  await expect(back).toBeDisabled();
});

// A window opened straight onto a route-backed detail has no history, so the
// mini-app registers its own fallback Back. That fallback must REPLACE the
// dead-end route: pushing its parent would create the one history entry that
// makes Back alternate between the two routes forever.
test("a deep-linked window's fallback Back does not stack a loop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");

  await expect(visiblePane(page)).toBeVisible({ timeout: 30_000 });
  const syncIndicator = page
    .getByRole("button", { name: /not yet synced/ })
    .first();
  await expect(syncIndicator).toBeVisible({ timeout: 30_000 });
  await syncIndicator.click();
  // Opens an Explorer window directly on the write-queue route.
  await page.getByRole("button", { name: "View write queue" }).click();

  const explorerWindow = page.locator(".window").first();
  const toolbar = explorerWindow.locator(".window-toolbar");
  await expect(explorerWindow).toBeVisible({ timeout: 30_000 });

  // No history behind it, so Explorer's own "Back to Explorer" fallback shows.
  const fallbackBack = toolbar.getByRole("button", {
    name: "Back to Explorer",
  });
  await expect(fallbackBack).toBeVisible();

  await fallbackBack.click();

  // It landed on the container listing, and left NO history entry behind — a
  // push here would let the next Back walk right back into the write queue.
  await expect(
    toolbar.getByRole("button", { name: "Create Child Folder" }),
  ).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Back" })).toBeDisabled();
});

test("SQLite tables survive a hard reload", async ({ page }) => {
  // Regression coverage for persistent OPFS-SAHPool reloads: the restored
  // identity must reopen its existing SQLite tables, not race a hidden pane or
  // fall back to a fresh empty database.
  await page.goto("/");

  const pane = visiblePane(page, "left");
  await generateKeyPair(page, pane);
  await waitForPaneBooted(pane);
  await expect(
    (await paneLogs(pane)).getByText("Local identity key package persisted"),
  ).toBeVisible({ timeout: 20_000 });
  const publicKey = await panePublicKey(pane);

  await page.reload({ waitUntil: "domcontentloaded" });

  const reloadedPane = visiblePane(page, "left");
  await waitForPaneBooted(reloadedPane);
  await expect
    .poll(() => paneStatusText(reloadedPane))
    .toContain(`Public Key: ${publicKey}`);
  const reloadedLogs = await paneLogs(reloadedPane);
  await expect(
    reloadedLogs.getByText("Local identity key package restored"),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    reloadedLogs.getByText(
      /Database characteristics \(pre-migration\): \d+ table\(s\), \d+ row\(s\) total/u,
    ),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    reloadedLogs.getByText(
      "Database characteristics (pre-migration): no tables",
    ),
  ).toHaveCount(0);
});

test("killed worker does not poison a hard reload", async ({ page }) => {
  await page.goto("/");

  const pane = visiblePane(page, "left");
  await generateKeyPair(page, pane);
  await waitForPaneBooted(pane);
  const publicKey = await panePublicKey(pane);

  await killWorker(page, pane);
  await page.reload({ waitUntil: "domcontentloaded" });

  const reloadedPane = visiblePane(page, "left");
  await waitForPaneBooted(reloadedPane);
  await expect
    .poll(() => paneStatusText(reloadedPane))
    .toContain(`Public Key: ${publicKey}`);
});

test("same persisted identity can boot in two tabs", async ({
  context,
  page,
}) => {
  await page.goto("/");

  const firstPane = visiblePane(page, "left");
  await generateKeyPair(page, firstPane);
  await waitForPaneBooted(firstPane);
  const publicKey = await panePublicKey(firstPane);

  const secondPage = await context.newPage();
  await secondPage.goto("/");

  const secondPane = visiblePane(secondPage, "left");
  await waitForPaneBooted(secondPane);
  await expect
    .poll(() => paneStatusText(secondPane))
    .toContain(`Public Key: ${publicKey}`);
  await expect(
    (await paneLogs(secondPane)).getByText(
      "Local identity key package restored",
    ),
  ).toBeVisible({ timeout: 20_000 });
});
