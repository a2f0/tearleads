import type { Locator, Page } from "@playwright/test";

// Shared helpers for driving the booted app shell in the screenshot run, used by
// both the capture spec and the seed-restore step.

const DISABLE_ANIMATIONS_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
  }
`;

export function visiblePane(page: Page): Locator {
  return page.locator(".pane:not(.pane-hidden)").first();
}

export async function waitForBooted(page: Page): Promise<void> {
  // Windowed shell mounts `.pane`; the routed (mobile) shell mounts
  // `.routed-pane`. Either means the app tree has rendered.
  await page
    .locator(".pane:not(.pane-hidden), .routed-pane")
    .first()
    .waitFor({ state: "visible", timeout: 60_000 });

  // Best-effort: let initial asset loads and any host-enabled identity autopilot
  // work settle. Never block on background network activity.
  await page.waitForLoadState("networkidle").catch(() => {});

  // Autopilot clears the first-run "Generate Key Pair" affordance once it has
  // derived the identity. If it never appears this resolves immediately.
  await page
    .getByText("Generate Key Pair")
    .first()
    .waitFor({ state: "hidden", timeout: 20_000 })
    .catch(() => {});

  // Small settle for the SQLite worker boot + first paint of mini-app content.
  await page.waitForTimeout(1_500);
}

export async function disableAnimations(page: Page): Promise<void> {
  // Re-inject after each navigation; a full load resets injected styles.
  await page.addStyleTag({ content: DISABLE_ANIMATIONS_CSS });
}

// Opens a mini-app as a floating window from the windowed shell's footer "Menu"
// launcher (see MINI_APP_MENU_ITEMS in packages/app/src/mini-apps/registry.ts).
export async function openWindowedApp(
  page: Page,
  menuLabel: string,
): Promise<void> {
  await visiblePane(page).locator(".pane-footer-menu-button").click();
  await page
    .locator(".menu")
    .getByRole("button", { name: menuLabel, exact: true })
    .click();
}

// The localStorage key the ThemeProvider reads on boot to restore an explicit
// theme choice (see packages/app/src/theme/themeStorage.ts). Writing it before a
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

// Restoring a backup authored under a different identity replaces the DB's root
// container, but the persisted session + document/container caches still point
// at the pre-restore root, so a plain reload re-bootstraps an empty root.
// Clearing them makes the next reload re-derive the root container + read models
// from the restored DB. (localStorage only; the identity registry is preserved
// so the same per-identity DB file is reopened.)
//
// The shipping backup-restore mini-app does the same clear before its post-restore
// reload via clearRestoredLocalCaches (packages/app/src/providers/db/
// clearRestoredLocalCaches.ts); keep the two prefix lists in sync. This helper
// runs in the browser page context (page.evaluate), so it cannot import that
// module and keeps its own copy of the prefixes.
export async function clearStaleLocalState(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (
        key.startsWith("tearleads.local-session") ||
        key.startsWith("tearleads.documents") ||
        key.startsWith("tearleads.container-metadata")
      ) {
        localStorage.removeItem(key);
      }
    }
  });
}
