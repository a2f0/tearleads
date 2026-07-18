import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { disableAnimations, waitForBooted } from "./appShell";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const OUTPUT_ROOT = path.join(REPO_ROOT, ".screenshots", "collaboration");

const NOTE_TITLE = "Authorship demo";
const OWNER_TEXT = [
  NOTE_TITLE,
  "Peer 1 drafted the release plan.",
  "Shared context belongs to the original author.",
].join("\n");
const PEER_TEXT = "Peer 2 added the rollout checklist.";
const COLLABORATIVE_TEXT = `${OWNER_TEXT}\n${PEER_TEXT}`;

const THEMES = ["light", "dark"] as const;

function activePane(page: Page, side: "left" | "right"): Locator {
  return page.locator(`.pane-${side}:not(.pane-hidden)`).first();
}

async function openPaneApp(
  page: Page,
  pane: Locator,
  label: string,
): Promise<Locator> {
  await pane.locator(".pane-footer-menu-button").click();
  await page
    .locator(".menu")
    .getByRole("button", { name: label, exact: true })
    .click();

  const window = pane.locator(".window").first();
  await expect(window).toBeVisible({ timeout: 30_000 });
  await expect(
    window.locator(".window-titlebar > span", { hasText: label }),
  ).toBeVisible();
  return window;
}

async function closePaneWindow(window: Locator): Promise<void> {
  await window.locator(".window-close").click();
  await expect(window).toBeHidden();
}

async function assertPaneAuthenticated(
  page: Page,
  pane: Locator,
): Promise<void> {
  const window = await openPaneApp(page, pane, "Org Manager");
  await expect(
    window.getByRole("button", { name: "Groups", exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    window.getByText("Authenticate to manage an organization."),
  ).toHaveCount(0);
  await closePaneWindow(window);
}

async function openAuthenticatedExplorers(page: Page): Promise<{
  ownerPane: Locator;
  ownerWindow: Locator;
  peerPane: Locator;
  peerWindow: Locator;
}> {
  const ownerPane = activePane(page, "left");
  const peerPane = activePane(page, "right");
  await expect(ownerPane).toBeVisible({ timeout: 60_000 });
  await expect(peerPane).toBeVisible({ timeout: 60_000 });

  await assertPaneAuthenticated(page, ownerPane);
  await assertPaneAuthenticated(page, peerPane);

  const ownerWindow = await openPaneApp(page, ownerPane, "Explorer");
  const peerWindow = await openPaneApp(page, peerPane, "Explorer");
  await expect(ownerWindow.locator(".explorer-sidebar-viewport")).toBeVisible({
    timeout: 30_000,
  });
  await expect(peerWindow.locator(".explorer-sidebar-viewport")).toBeVisible({
    timeout: 30_000,
  });
  await ensureExplorerReady(ownerWindow);
  await ensureExplorerReady(peerWindow);

  return { ownerPane, ownerWindow, peerPane, peerWindow };
}

async function ensureExplorerReady(window: Locator): Promise<void> {
  const firstItem = window.locator("button.explorer-sidebar-item").first();
  const retry = window
    .locator(".explorer-sidebar")
    .getByRole("button", { name: "Retry", exact: true })
    .first();
  await expect
    .poll(
      async () => {
        if (await firstItem.isVisible()) {
          return "ready";
        }
        return (await retry.isVisible()) ? "retry" : "waiting";
      },
      { timeout: 60_000 },
    )
    .not.toBe("waiting");

  if (await retry.isVisible()) {
    await retry.click();
  }
  await expect(firstItem).toBeVisible({ timeout: 60_000 });
}

function noteButton(window: Locator): Locator {
  return window
    .locator(
      "button.explorer-sidebar-item--note, button.explorer-item-row-button",
    )
    .filter({ hasText: NOTE_TITLE })
    .first();
}

async function selectNote(window: Locator): Promise<Locator> {
  const button = noteButton(window);
  await expect(button).toBeVisible({ timeout: 60_000 });
  await button.click();
  const editor = window.getByRole("textbox", { name: /Notes editor/u });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  return editor;
}

async function clickContextMenuAction(
  page: Page,
  target: Locator,
  action: string,
): Promise<void> {
  await target.click({ button: "right" });
  const menu = page.locator(".menu").last();
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: action, exact: true }).click();
}

async function createOwnerNote(
  page: Page,
  ownerWindow: Locator,
): Promise<Locator> {
  const ownerRoot = ownerWindow
    .locator("button.explorer-sidebar-item")
    .filter({ hasText: /^\/$/u })
    .first();
  await expect(ownerRoot).toBeVisible({ timeout: 30_000 });
  await ownerRoot.click();
  await expect(
    ownerWindow.getByRole("table", { name: "Items in /", exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  await ownerWindow.getByRole("menuitem", { name: "File" }).click();
  const newDocument = ownerWindow.getByRole("menuitem", {
    name: "New Document",
    exact: true,
  });
  await expect(newDocument).toBeEnabled({ timeout: 60_000 });
  await newDocument.click();
  await ownerWindow.getByRole("button", { name: "Note", exact: true }).click();

  const editor = ownerWindow.getByRole("textbox", { name: /Notes editor/u });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  const createResponse = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "POST" &&
        url.pathname === "/documents" &&
        response.status() === 200
      );
    },
    { timeout: 60_000 },
  );
  await editor.fill(OWNER_TEXT);
  await expect(editor).toHaveValue(OWNER_TEXT);
  await createResponse;

  const button = noteButton(ownerWindow);
  await expect(button).toBeVisible({ timeout: 30_000 });
  return button;
}

async function shareOwnerRootWithPeer(
  page: Page,
  ownerWindow: Locator,
): Promise<void> {
  const ownerRoot = ownerWindow
    .locator("button.explorer-sidebar-item")
    .filter({ hasText: /^\/$/u })
    .first();
  await expect(ownerRoot).toBeVisible({ timeout: 30_000 });
  await clickContextMenuAction(page, ownerRoot, "Get Info");

  await expect(
    ownerWindow.getByText("Container Info", { exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await ownerWindow.getByRole("tab", { name: "Sharing", exact: true }).click();
  const shareButton = ownerWindow.getByRole("button", {
    name: "Share With Peer",
    exact: true,
  });
  await expect(shareButton).toBeEnabled({ timeout: 60_000 });

  const shareResponse = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "POST" &&
        url.pathname.endsWith("/share") &&
        response.status() === 200
      );
    },
    { timeout: 60_000 },
  );
  await shareButton.click();
  await shareResponse;
  await expect(shareButton).toBeEnabled({ timeout: 60_000 });
}

async function appendPeerText(page: Page, peerWindow: Locator): Promise<void> {
  const editor = await selectNote(peerWindow);
  await expect(editor).toHaveValue(OWNER_TEXT, { timeout: 60_000 });

  const syncResponse = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "POST" &&
        /^\/documents\/[^/]+\/sync$/u.test(url.pathname) &&
        response.status() === 200
      );
    },
    { timeout: 60_000 },
  );
  await editor.fill(COLLABORATIVE_TEXT);
  await expect(editor).toHaveValue(COLLABORATIVE_TEXT);
  await syncResponse;
}

async function openDocumentBlame(
  page: Page,
  ownerWindow: Locator,
): Promise<Locator> {
  const button = noteButton(ownerWindow);
  await expect(button).toBeVisible({ timeout: 60_000 });
  const attributionResponse = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET" &&
        url.pathname.endsWith("/attribution") &&
        response.status() === 200
      );
    },
    { timeout: 60_000 },
  );
  await clickContextMenuAction(page, button, "Get Info");
  await attributionResponse;

  await expect(
    ownerWindow.getByText("Document Info", { exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    ownerWindow.getByText("Character Blame", { exact: true }),
  ).toBeVisible({
    timeout: 60_000,
  });

  const prose = ownerWindow.locator(".explorer-blame-prose");
  await expect(prose).toBeVisible({ timeout: 60_000 });
  await expect(prose).toHaveText(COLLABORATIVE_TEXT);

  const legendItems = ownerWindow.locator(".explorer-blame-legend-item");
  await expect
    .poll(() => legendItems.count(), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(2);
  await expect(legendItems.filter({ hasText: /Peer 1/u }).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(legendItems.filter({ hasText: /Peer 2/u }).first()).toBeVisible({
    timeout: 60_000,
  });

  const attributedRuns = ownerWindow.locator(
    ".explorer-blame-run:not(.explorer-blame-run--unattributed)",
  );
  await expect
    .poll(() => attributedRuns.count(), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(2);
  const runTitles = await attributedRuns.evaluateAll((runs) =>
    runs.map((run) => run.getAttribute("title") ?? ""),
  );
  expect(runTitles.some((title) => title.includes("Peer 1"))).toBe(true);
  expect(runTitles.some((title) => title.includes("Peer 2"))).toBe(true);
  await expect(
    ownerWindow.locator(".explorer-blame-run--unattributed"),
  ).toHaveCount(0);

  await prose.scrollIntoViewIfNeeded();
  return prose;
}

async function screenshotOpenBlame(
  ownerWindow: Locator,
  theme: (typeof THEMES)[number],
): Promise<void> {
  const prose = ownerWindow.locator(".explorer-blame-prose");
  await expect(prose).toBeVisible();
  await expect(prose).toHaveText(COLLABORATIVE_TEXT);
  await prose.scrollIntoViewIfNeeded();
  const outputDir = path.join(OUTPUT_ROOT, theme);
  await mkdir(outputDir, { recursive: true });
  await ownerWindow.screenshot({
    path: path.join(outputDir, "note-blame.png"),
  });
}

test("capture two-peer note blame", async ({ page }, testInfo) => {
  const { SCREENSHOT_COLLABORATION } = process.env;
  test.skip(
    testInfo.project.name !== "collaboration" &&
      SCREENSHOT_COLLABORATION !== "1",
    "Runs only in the collaboration screenshot project.",
  );
  test.setTimeout(300_000);

  await page.addInitScript(() => {
    localStorage.setItem("tearleads.theme.choice", "light");
  });
  await page.goto("/");
  await waitForBooted(page);
  await disableAnimations(page);
  await page.waitForFunction(
    () => document.documentElement.getAttribute("data-theme") === "light",
    undefined,
    { timeout: 30_000 },
  );

  const { ownerPane, ownerWindow, peerWindow } =
    await openAuthenticatedExplorers(page);
  await ownerWindow.locator(".window-maximize").click();
  await peerWindow.locator(".window-maximize").click();

  await createOwnerNote(page, ownerWindow);
  await shareOwnerRootWithPeer(page, ownerWindow);
  const ownerEditor = await selectNote(ownerWindow);
  await expect(ownerEditor).toHaveValue(OWNER_TEXT);

  await appendPeerText(page, peerWindow);
  await expect(ownerEditor).toHaveValue(COLLABORATIVE_TEXT, {
    timeout: 60_000,
  });
  await openDocumentBlame(page, ownerWindow);
  await screenshotOpenBlame(ownerWindow, "light");

  await ownerPane
    .getByRole("button", { name: "Switch to Dark theme", exact: true })
    .click();
  await page.waitForFunction(
    () => document.documentElement.getAttribute("data-theme") === "dark",
    undefined,
    { timeout: 30_000 },
  );
  await screenshotOpenBlame(ownerWindow, "dark");
});
