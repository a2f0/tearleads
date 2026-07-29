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

async function captureWorkersForTermination(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const workers: Worker[] = [];
    class TrackedWorker extends NativeWorker {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        workers.push(this);
      }
    }
    Reflect.set(window, "Worker", TrackedWorker);
    Reflect.set(window, "__tearleadsE2eWorkers", workers);
  });
}

async function terminateLatestWorker(page: Page): Promise<void> {
  await page.evaluate(() => {
    const workers = Reflect.get(window, "__tearleadsE2eWorkers");
    const worker = Array.isArray(workers) ? workers.at(-1) : undefined;
    if (!(worker instanceof Worker)) {
      throw new Error("Expected the E2E harness to capture a worker.");
    }
    worker.terminate();
  });
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

  // There is no Back action until the window has route history to unwind.
  await expect(
    toolbar.getByRole("button", { name: "New Document" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(back).toHaveCount(0);

  await toolbar.getByRole("button", { name: "New Document" }).click();
  await explorerWindow
    .getByRole("button", { name: /Blood Pressure/ })
    .first()
    .click();
  // A freshly created document opens in edit mode, so its toolbar carries Done.
  await expect(toolbar.getByRole("button", { name: "Done" })).toBeVisible();

  await explorerWindow.getByRole("button", { name: "Add Reading" }).click();
  for (const [label, expectedCap] of [
    ["Reading 1 systolic", 7],
    ["Reading 1 diastolic", 7],
    ["Reading 1 pulse", 7],
    ["Reading 1 measured at", 14],
  ] as const) {
    const input = explorerWindow.getByLabel(label);
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
  await expect(back).toHaveCount(0);
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
  await expect(toolbar.getByRole("button", { name: "Back" })).toHaveCount(0);
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
      /Database characteristics \(pre-schema\): \d+ table\(s\), \d+ row\(s\) total/u,
    ),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    reloadedLogs.getByText("Database characteristics (pre-schema): no tables"),
  ).toHaveCount(0);
});

test("killed worker does not poison a hard reload", async ({ page }) => {
  // The product no longer exposes worker termination as routed toolbar chrome.
  // Capture the browser worker before boot so this recovery test can still
  // simulate an unexpected termination without restoring that UI action.
  await captureWorkersForTermination(page);
  await page.goto("/");

  const pane = visiblePane(page, "left");
  await generateKeyPair(page, pane);
  await waitForPaneBooted(pane);
  const publicKey = await panePublicKey(pane);
  await expect(
    (await paneLogs(pane)).getByText("Local identity key package persisted"),
  ).toBeVisible({ timeout: 20_000 });

  // Restore once before forcing the crash so the assertion isolates worker
  // termination from the independent first-generation persistence race.
  await page.reload({ waitUntil: "domcontentloaded" });
  const restoredPane = visiblePane(page, "left");
  await waitForPaneBooted(restoredPane);
  await expect
    .poll(() => paneStatusText(restoredPane))
    .toContain(`Public Key: ${publicKey}`);

  await terminateLatestWorker(page);
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

// The folder you are inside is the one thing on the Explorer's container pane
// with no row of its own — the listing shows its children — so its own actions
// hang off the header that names it. A ROOT folder has no other route to them at
// all: nothing lists it, so there is no row to right-click anywhere. Driven by
// the keyboard here, which is also the case the pointer-positioned context menu
// gets wrong on its own: Enter reports 0,0 client coordinates, and a menu placed
// there opens in the viewport's corner instead of under the trigger.
test("the container header kebab reaches the current folder's actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");

  const pane = visiblePane(page);
  await expect(pane).toBeVisible({ timeout: 30_000 });
  await pane.click({ button: "right", position: { x: 120, y: 120 } });
  await page.getByRole("button", { name: "Explorer" }).first().click();

  const explorerWindow = page.locator(".window").first();
  const header = explorerWindow
    .locator(".explorer-detail .mini-app-header")
    .first();
  await expect(header).toBeVisible({ timeout: 30_000 });
  const folderName = await header.locator("strong").first().innerText();

  const kebab = header.getByRole("button", {
    name: `Folder actions: ${folderName}`,
  });
  const kebabBox = await kebab.boundingBox();
  await kebab.focus();
  await page.keyboard.press("Enter");

  const menu = page.locator(".menu").first();
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox();
  if (!kebabBox || !menuBox) {
    throw new Error("Expected the header kebab and its menu to be laid out.");
  }
  expect(menuBox.x).toBeCloseTo(kebabBox.x, 0);
  expect(menuBox.y).toBeGreaterThanOrEqual(kebabBox.y + kebabBox.height - 1);

  // Get Info is the entry the header kebab exists for: the current folder's
  // properties, which the listing's own rows can only reach for their children.
  await menu.getByText("Get Info", { exact: true }).click();
  await expect(
    explorerWindow.getByRole("tab", { name: "General" }),
  ).toBeVisible();
});
