import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";

// This file lives at packages/app-web/screenshots/, so the repo root is three
// levels up. Screenshots are written to `<repoRoot>/.screenshots/<project>/`.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

// The app self-provisions an identity on boot via IdentityAutopilot (the default
// "app" host profile sets autoGenerateIdentity) and the local keychain is
// unlocked on a fresh context, so no manual "Generate Key Pair" step is needed.
// Both layouts are captured from one spec, branching on the rendered shell:
//
//   mobile -> routed layout: one mini-app per URL; screenshot the viewport.
//   web    -> windowed desktop: open each mini-app as a floating window from the
//             footer launcher and screenshot the window element only.

interface RoutedScreen {
  /** URL to load; see packages/app/src/navigation/AppRoutePaths.ts. */
  route: string;
  /** Output file stem (`<name>.png`). */
  name: string;
}

// Home plus every mini-app route. `/` lands on Explorer (the routed root app).
// Keep in sync with packages/app/src/mini-apps/registry.ts.
const ROUTED_SCREENS: readonly RoutedScreen[] = [
  { route: "/", name: "home" },
  { route: "/app/explorer", name: "explorer" },
  { route: "/app/contacts", name: "contacts" },
  { route: "/app/org-manager", name: "org-manager" },
  { route: "/app/notes", name: "notes" },
  { route: "/app/identity-manager", name: "identity-manager" },
  { route: "/app/backup-restore", name: "backup-restore" },
  { route: "/app/system-monitor", name: "system-monitor" },
];

interface WindowedApp {
  /** Output file stem (`<name>.png`). */
  name: string;
  /** Footer-launcher menu label; see MINI_APP_MENU_ITEMS in registry.ts. */
  menuLabel: string;
}

// Windowed apps opened from the footer "Menu" launcher. System Monitor is
// launched from the footer tray instead (see registry.ts) and is handled
// separately below.
const WINDOWED_MENU_APPS: readonly WindowedApp[] = [
  { name: "explorer", menuLabel: "Explorer" },
  { name: "contacts", menuLabel: "Contacts" },
  { name: "org-manager", menuLabel: "Org Manager" },
  { name: "notes", menuLabel: "Notes" },
  { name: "identity-manager", menuLabel: "Identity Manager" },
  { name: "backup-restore", menuLabel: "Backup / Restore" },
];

const DISABLE_ANIMATIONS_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
  }
`;

function visiblePane(page: Page): Locator {
  return page.locator(".pane:not(.pane-hidden)").first();
}

async function waitForBooted(page: Page): Promise<void> {
  // Windowed shell mounts `.pane`; the routed (mobile) shell mounts
  // `.routed-pane`. Either means the app tree has rendered.
  await page
    .locator(".pane:not(.pane-hidden), .routed-pane")
    .first()
    .waitFor({ state: "visible", timeout: 60_000 });

  // Best-effort: let the auto-registration attempt (which targets the dev API and
  // may be refused) and initial asset loads settle. Never block on it.
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

async function disableAnimations(page: Page): Promise<void> {
  // Re-inject after each navigation; a full load resets injected styles.
  await page.addStyleTag({ content: DISABLE_ANIMATIONS_CSS });
}

async function captureRouted(page: Page, outputDir: string): Promise<void> {
  for (const screen of ROUTED_SCREENS) {
    await page.goto(screen.route);
    await waitForBooted(page);
    await disableAnimations(page);
    await page.screenshot({
      path: path.join(outputDir, `${screen.name}.png`),
      fullPage: false,
    });
  }
}

// Screenshots the currently-open window (maximized for a large, uniform capture)
// and then closes it so the desktop is empty for the next app.
async function captureOpenWindow(
  page: Page,
  outputDir: string,
  name: string,
): Promise<void> {
  const pane = visiblePane(page);
  const window = pane.locator(".window").first();
  await window.waitFor({ state: "visible", timeout: 20_000 });
  await window.locator(".window-maximize").click();
  // Let the freshly-mounted app's data queries resolve so content is not
  // captured mid-"Loading…". Best-effort, then a short settle for first paint.
  await window
    .getByText("Loading...")
    .first()
    .waitFor({ state: "hidden", timeout: 10_000 })
    .catch(() => {});
  await page.waitForTimeout(1_000);
  await disableAnimations(page);
  await window.screenshot({ path: path.join(outputDir, `${name}.png`) });
  await window.locator(".window-close").click();
  await expect(pane.locator(".window")).toHaveCount(0);
}

async function captureWindowed(page: Page, outputDir: string): Promise<void> {
  for (const app of WINDOWED_MENU_APPS) {
    await visiblePane(page).locator(".pane-footer-menu-button").click();
    await page
      .locator(".menu")
      .getByRole("button", { name: app.menuLabel, exact: true })
      .click();
    await captureOpenWindow(page, outputDir, app.name);
  }

  // System Monitor lives in the footer tray, not the launcher menu.
  await visiblePane(page)
    .getByRole("button", { name: "System Monitor" })
    .click();
  await captureOpenWindow(page, outputDir, "system-monitor");
}

test("capture screenshots", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const outputDir = path.join(REPO_ROOT, ".screenshots", project);
  await mkdir(outputDir, { recursive: true });

  await page.goto("/");
  await waitForBooted(page);

  const routed = (await page.locator(".routed-pane").count()) > 0;
  if (routed) {
    await captureRouted(page, outputDir);
  } else {
    await captureWindowed(page, outputDir);
  }
});
