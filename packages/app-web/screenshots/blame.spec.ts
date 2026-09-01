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

const NOTE_TITLE = "Authorship demo";
const OWNER_TEXT = [
  NOTE_TITLE,
  "Peer 1 drafted the release plan.",
  "Shared context belongs to the original author.",
].join("\n");
const PEER_TEXT = "Peer 2 added the rollout checklist.";
const COLLABORATIVE_TEXT = `${OWNER_TEXT}\n${PEER_TEXT}`;

const THEMES = ["light", "dark"] as const;
const SETUP_VIEWPORT = { width: 1440, height: 900 };

type ScreenshotLayout = "web" | "ipad" | "mobile";
type ScreenshotScope = Locator | Page;

function readScreenshotLayout(
  metadata: Record<string, unknown>,
): ScreenshotLayout {
  const layout: unknown = Reflect.get(metadata, "screenshotLayout");
  if (layout === "web" || layout === "ipad" || layout === "mobile") {
    return layout;
  }
  throw new Error("Missing blame screenshot layout metadata.");
}

function activePane(page: Page, side: "left" | "right"): Locator {
  return page.locator(`.pane-${side}:not(.pane-hidden)`).first();
}

async function openPaneMenu(page: Page, pane: Locator): Promise<Locator> {
  const launcher = pane.locator(".pane-footer-menu-button");
  if ((await launcher.getAttribute("aria-expanded")) !== "true") {
    await launcher.click();
  }
  const menu = page.locator(".menu:visible").last();
  await expect(menu).toBeVisible();
  return menu;
}

async function openPaneApp(
  page: Page,
  pane: Locator,
  label: string,
): Promise<Locator> {
  let menu = await openPaneMenu(page, pane);
  const generateKey = menu.getByRole("button", {
    name: "Generate Key Pair",
    exact: true,
  });
  if (await generateKey.isVisible()) {
    await generateKey.click();
    menu = await openPaneMenu(page, pane);
  }
  const app = menu.getByRole("button", { name: label, exact: true });
  await expect(app).toBeVisible({ timeout: 30_000 });
  await app.click();

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

function noteButton(scope: ScreenshotScope): Locator {
  return scope
    .locator(
      "button.explorer-sidebar-item--note, button.explorer-item-row-button",
    )
    .filter({ hasText: NOTE_TITLE })
    .first();
}

async function selectNote(scope: ScreenshotScope): Promise<Locator> {
  const button = noteButton(scope);
  await expect(button).toBeVisible({ timeout: 60_000 });
  await button.click();
  const editor = scope.getByRole("textbox", { name: /Notes editor/u });
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

async function waitForBlame(scope: ScreenshotScope): Promise<Locator> {
  await expect(scope.getByText("Document Info", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(scope.getByText("Character Blame", { exact: true })).toBeVisible(
    {
      timeout: 60_000,
    },
  );

  const prose = scope.locator(".explorer-blame-prose");
  await expect(prose).toBeVisible({ timeout: 60_000 });
  await expect(prose).toHaveText(COLLABORATIVE_TEXT);

  const legendItems = scope.locator(".explorer-blame-legend-item");
  await expect
    .poll(() => legendItems.count(), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(2);
  await expect(legendItems.filter({ hasText: /Peer 1/u }).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(legendItems.filter({ hasText: /Peer 2/u }).first()).toBeVisible({
    timeout: 60_000,
  });

  const attributedRuns = scope.locator(
    ".explorer-blame-run:not(.explorer-blame-run--unattributed)",
  );
  await expect
    .poll(() => attributedRuns.count(), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(2);
  await expect(
    scope.locator('.explorer-blame-run[title*="Peer 1"]'),
  ).not.toHaveCount(0, { timeout: 60_000 });
  await expect(
    scope.locator('.explorer-blame-run[title*="Peer 2"]'),
  ).not.toHaveCount(0, { timeout: 60_000 });
  await expect(scope.locator(".explorer-blame-run--unattributed")).toHaveCount(
    0,
  );

  await prose.scrollIntoViewIfNeeded();
  return prose;
}

function attributionResponse(page: Page): Promise<unknown> {
  return page.waitForResponse(
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
}

async function openWindowedDocumentBlame(
  page: Page,
  ownerWindow: Locator,
): Promise<void> {
  const button = noteButton(ownerWindow);
  await expect(button).toBeVisible({ timeout: 60_000 });
  const response = attributionResponse(page);
  await clickContextMenuAction(page, button, "Get Info");
  await response;
  await waitForBlame(ownerWindow);
}

async function openRoutedDocumentBlame(
  page: Page,
  routedPane: Locator,
): Promise<void> {
  const editor = await selectNote(routedPane);
  await expect(editor).toHaveValue(COLLABORATIVE_TEXT, { timeout: 60_000 });
  const response = attributionResponse(page);
  await routedPane
    .getByRole("button", { name: "Get Info", exact: true })
    .click();
  await response;
  await waitForBlame(routedPane);
}

async function switchToWindowed(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Switch to windowed layout", exact: true })
    .click();
  await expect(activePane(page, "left")).toBeVisible({ timeout: 30_000 });
}

async function switchToRouted(
  page: Page,
  ownerPane: Locator,
  viewport: { width: number; height: number },
  layout: Exclude<ScreenshotLayout, "web">,
): Promise<Locator> {
  await ownerPane
    .getByRole("button", {
      name: "Switch to iPad / mobile layout",
      exact: true,
    })
    .click();
  const routedPane = page.locator(".routed-pane").first();
  await expect(routedPane).toBeVisible({ timeout: 30_000 });
  await page.setViewportSize(viewport);
  const tier = layout === "ipad" ? "tablet" : "mobile";
  await expect(routedPane).toHaveClass(new RegExp(`routed-pane--${tier}`));
  return routedPane;
}

async function switchToDarkTheme(
  page: Page,
  ownerPane: Locator,
): Promise<void> {
  await ownerPane
    .getByRole("button", { name: "Switch to Dark theme", exact: true })
    .click();
  await page.waitForFunction(
    () => document.documentElement.getAttribute("data-theme") === "dark",
    undefined,
    { timeout: 30_000 },
  );
}

async function screenshotOpenBlame(
  page: Page,
  scope: Locator,
  layout: ScreenshotLayout,
  theme: (typeof THEMES)[number],
): Promise<void> {
  await waitForBlame(scope);
  const outputDir = path.join(REPO_ROOT, ".screenshots", layout, theme);
  await mkdir(outputDir, { recursive: true });
  const screenshotPath = path.join(outputDir, "note-blame.png");
  if (layout === "web") {
    await scope.screenshot({ path: screenshotPath });
  } else {
    await page.screenshot({ path: screenshotPath, fullPage: false });
  }
}

test("capture two-peer note blame", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const layout = readScreenshotLayout(testInfo.project.metadata);
  const captureViewport = page.viewportSize();
  if (!captureViewport) {
    throw new Error(`Missing viewport for blame-${layout}.`);
  }

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
  if (layout !== "web") {
    await switchToWindowed(page);
    await page.setViewportSize(SETUP_VIEWPORT);
  }

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

  if (layout === "web") {
    await openWindowedDocumentBlame(page, ownerWindow);
    await screenshotOpenBlame(page, ownerWindow, layout, "light");
    await switchToDarkTheme(page, ownerPane);
    await screenshotOpenBlame(page, ownerWindow, layout, "dark");
    return;
  }

  let routedPane = await switchToRouted(
    page,
    ownerPane,
    captureViewport,
    layout,
  );
  await openRoutedDocumentBlame(page, routedPane);
  await screenshotOpenBlame(page, routedPane, layout, "light");

  await switchToWindowed(page);
  await page.setViewportSize(SETUP_VIEWPORT);
  await switchToDarkTheme(page, ownerPane);
  routedPane = await switchToRouted(page, ownerPane, captureViewport, layout);
  await screenshotOpenBlame(page, routedPane, layout, "dark");
});
