import { expect, type Locator, type Page, test } from "@playwright/test";

const SQLITE_READY_PATTERN = /sqlite worker:\s*ready/u;
const PUBLIC_KEY_PATTERN = /publicKey:\s*([0-9a-f]{64})/u;

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
  await pane.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Kill Worker" }).click();
}

async function showSystemMonitorTab(
  pane: Locator,
  tabName: "Logs" | "Status",
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
  await page.goto("/");

  await expect(page).toHaveTitle("App");
  const firstVisiblePane = visiblePane(page);
  await generateKeyPair(page, firstVisiblePane);

  await waitForPaneBooted(firstVisiblePane);
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
    .toContain(`publicKey: ${publicKey}`);
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
    .toContain(`publicKey: ${publicKey}`);
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
    .toContain(`publicKey: ${publicKey}`);
  await expect(
    (await paneLogs(secondPane)).getByText(
      "Local identity key package restored",
    ),
  ).toBeVisible({ timeout: 20_000 });
});
