import { expect, type Locator, type Page, test } from "@playwright/test";

const SQLITE_READY_PATTERN = /sqlite worker:\s*ready/u;
const PUBLIC_KEY_PATTERN = /publicKey:\s*([0-9a-f]{64})/u;

function visiblePane(page: Page, side?: "left" | "right"): Locator {
  const sideClass = side ? `.pane-${side}` : "";
  return page.locator(`${sideClass}.pane:not(.pane-hidden)`).first();
}

async function generateKeyPair(page: Page, pane: Locator): Promise<void> {
  await pane.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Generate Key Pair" }).click();
}

async function waitForPaneBooted(pane: Locator): Promise<void> {
  const status = pane.locator(".pane-content");
  await expect(status).toContainText(SQLITE_READY_PATTERN, {
    timeout: 30_000,
  });
  await expect(status).toContainText(PUBLIC_KEY_PATTERN, { timeout: 30_000 });
}

async function panePublicKey(pane: Locator): Promise<string> {
  const statusText = await pane.locator(".pane-content").innerText();
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
  await expect(
    firstVisiblePane.getByText(
      "Generate a key pair from the pane menu to boot this pane.",
    ),
  ).toBeVisible();
  await generateKeyPair(page, firstVisiblePane);

  await waitForPaneBooted(firstVisiblePane);
});

test("both visible panes can boot persistent SQLite", async ({ page }) => {
  await page.goto("/");

  const leftPane = visiblePane(page, "left");
  const rightPane = visiblePane(page, "right");

  await generateKeyPair(page, leftPane);
  await waitForPaneBooted(leftPane);

  await generateKeyPair(page, rightPane);
  await waitForPaneBooted(rightPane);
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
    pane.getByText("Local identity key package persisted"),
  ).toBeVisible({ timeout: 20_000 });
  const publicKey = await panePublicKey(pane);

  await page.reload({ waitUntil: "domcontentloaded" });

  const reloadedPane = visiblePane(page, "left");
  await waitForPaneBooted(reloadedPane);
  await expect(reloadedPane.locator(".pane-content")).toContainText(
    `publicKey: ${publicKey}`,
  );
  await expect(
    reloadedPane.getByText("Local identity key package restored"),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    reloadedPane.getByText(
      /Database characteristics \(pre-migration\): \d+ table\(s\), \d+ row\(s\) total/u,
    ),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    reloadedPane.getByText(
      "Database characteristics (pre-migration): no tables",
    ),
  ).toHaveCount(0);
});
