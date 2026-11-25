import { expect, type Locator, type Page } from "@playwright/test";
import {
  agreeToLegalTerms,
  legalTermsAgreement,
} from "../e2e/legalTermsAgreement";

// Shared helpers for driving the booted app shell, used by the screenshot run
// and by e2e specs.

const DISABLE_ANIMATIONS_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
  }
`;

const windowedScreenshotPages = new WeakSet<Page>();
// A quiet app loads its assets in under a second.
const ASSET_SETTLE_TIMEOUT_MS = 2_000;

/**
 * How `waitForBooted` lets the network settle: "idle" waits until it goes
 * idle, "assets" for at most two seconds, enough for a quiet app's assets.
 */
export type BootSettle = "idle" | "assets";

export function preferWindowedScreenshotLayout(page: Page): void {
  windowedScreenshotPages.add(page);
}

export function visiblePane(page: Page): Locator {
  return page.locator(".pane:not(.pane-hidden)").first();
}

export async function showExplorerSidebar(window: Locator): Promise<void> {
  await window.getByRole("menuitem", { name: "View", exact: true }).click();
  await window.getByRole("menuitem", { name: "Show Sidebar" }).click();
  await expect(window.locator(".explorer-sidebar-viewport")).toBeVisible({
    timeout: 30_000,
  });
}

// Screenshot setup opens one app at a time and assumes an empty desktop.
// Call only after boot or the initial layout switch, preserving later windows.
async function closeDefaultExplorerWindows(page: Page): Promise<void> {
  const explorers = page.getByRole("region", { name: "Explorer", exact: true });
  while (await explorers.count()) {
    await explorers
      .first()
      .getByRole("button", { name: "Close window" })
      .click();
  }
  await expect(explorers).toHaveCount(0);
}

export async function waitForBooted(
  page: Page,
  settle: BootSettle = "idle",
): Promise<void> {
  // Windowed shell mounts `.pane`; the routed (tablet/mobile) shell mounts
  // `.routed-pane`. Either means the app tree has rendered. The demo first
  // asks for agreement to the legal terms, and starts its panes after it.
  const panes = page.locator(".pane:not(.pane-hidden), .routed-pane");
  const demoAgreement = page.locator(".demo-legal-terms-gate");
  await panes
    .or(demoAgreement)
    .first()
    .waitFor({ state: "visible", timeout: 60_000 });
  if (await demoAgreement.isVisible()) {
    await agreeToLegalTerms(legalTermsAgreement(page));
    await panes.first().waitFor({ state: "visible", timeout: 60_000 });
  }

  if (
    windowedScreenshotPages.has(page) &&
    !(await page.locator(".pane:not(.pane-hidden)").first().isVisible())
  ) {
    await page
      .getByRole("button", { name: "Switch to windowed layout" })
      .click();
    await page
      .locator(".pane:not(.pane-hidden)")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  }

  // Best-effort: let initial asset loads and any host-enabled identity autopilot
  // work settle. Setup steps wait for idle so the seeded data is on the device
  // before the first capture. A reload that cuts sign-in short no longer loses
  // it (the next start lists the document lanes the cut boot left owed), but
  // that later start would still race the capture. Capture loops pass
  // "assets": the seeded data is on the device by then, and every full load
  // re-syncs it for about 10 s, which ran the routed captures past the test
  // timeout.
  await page
    .waitForLoadState(
      "networkidle",
      settle === "assets" ? { timeout: ASSET_SETTLE_TIMEOUT_MS } : {},
    )
    .catch(() => {});

  // Autopilot clears the first-run "Generate Key Pair" affordance once it has
  // derived the identity. If it never appears this resolves immediately.
  await page
    .getByText("Generate Key Pair")
    .first()
    .waitFor({ state: "hidden", timeout: 20_000 })
    .catch(() => {});

  // Small settle for the SQLite worker boot + first paint of mini-app content.
  await page.waitForTimeout(1_500);
  await closeDefaultExplorerWindows(page);
}

export async function disableAnimations(page: Page): Promise<void> {
  // Re-inject after each navigation; a full load resets injected styles.
  await page.addStyleTag({ content: DISABLE_ANIMATIONS_CSS });
}

// The desktop context menu also lists apps hidden from the Start menu.
export async function openWindowedApp(
  page: Page,
  menuLabel: string,
): Promise<void> {
  await visiblePane(page).dispatchEvent("contextmenu", {
    clientX: 120,
    clientY: 120,
  });
  await page
    .locator(".menu")
    .getByRole("button", { name: menuLabel, exact: true })
    .click();
}

// The localStorage key the ThemeProvider reads on boot to restore an explicit
// theme choice (see packages/app/src/theme/ThemeProvider.tsx). Writing it before a
// reload pins the app to that theme deterministically — an explicit choice wins
// over the OS preference — so the screenshot run can capture a known theme rather
// than whatever `prefers-color-scheme` happens to emulate. clearStaleLocalState
// leaves this key untouched, so a pinned theme also survives the seed reload.
const THEME_CHOICE_STORAGE_KEY = "tearleads.theme.choice";

// Pins the app to `theme` ("light" | "dark") on the next boot. Runs in the page
// context (page.evaluate), so it writes localStorage directly rather than
// importing the app's saveTheme.
export async function setStoredTheme(page: Page, theme: string): Promise<void> {
  await page.evaluate(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [THEME_CHOICE_STORAGE_KEY, theme] as const,
  );
}
