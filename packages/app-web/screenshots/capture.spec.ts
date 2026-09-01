import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  clearStaleLocalState,
  disableAnimations,
  openWindowedApp,
  setStoredTheme,
  visiblePane,
  waitForBooted,
} from "./appShell";
import {
  assertOrgManagerCaptureReady,
  assertRoutedOrgManagerBaseCaptureReady,
  captureRoutedOrgManagerSections,
  ORG_MANAGER_SCREENS,
} from "./orgManagerScreens";
import {
  assertAuthenticatedOrgManager,
  authenticateOrRegisterScreenshotIdentity,
} from "./screenshotAuth";
import { importSeedIdentity } from "./seedIdentity";
import { restoreSeedBackup } from "./seedRestore";

// This file lives at packages/app-web/screenshots/, so the repo root is three
// levels up. Screenshots are written to
// `<repoRoot>/.screenshots/<project>/<theme>/` — each layout (project) is
// captured once per theme (light, dark) into its own subfolder.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

// The seed fixture (spec) is committed; the artifact it produces is not — it is
// gitignored and regenerated at the repo root by the `prescreenshots` step (and
// on demand via `bun run screenshots:seed`).
const SEED_FIXTURES_DIR = path.join(
  REPO_ROOT,
  "packages/app/test/screenshot-seed/fixtures",
);
const SEED_ARTIFACT_PATH = path.join(REPO_ROOT, "tearleads-seed.tlbackup.json");
// Password + identity phrase come from the fixture so they never drift from the
// artifact they were authored with.
const SEED_SPEC = JSON.parse(
  readFileSync(path.join(SEED_FIXTURES_DIR, "seed.json"), "utf8"),
) as { password: string; identitySeedPhrase: string };
const SEED_PASSWORD = SEED_SPEC.password;
const SEED_IDENTITY_PHRASE = SEED_SPEC.identitySeedPhrase;

// The app self-provisions an identity on boot via IdentityAutopilot (the default
// "app" host profile sets autoGenerateIdentity) and the local keychain is
// unlocked on a fresh context. We then restore the seed artifact through the
// backup-restore mini-app and reload so the app reopens the populated DB under
// the same persisted identity. Both layouts are captured from one spec:
//
//   mobile -> routed layout: one mini-app per URL; screenshot the viewport.
//   web    -> windowed desktop: open each mini-app as a floating window from the
//             footer launcher and screenshot the window element only.
//
// Each layout is then captured once per theme — light and dark — with the theme
// pinned via localStorage and the app reloaded between passes (see applyTheme).

// The themes to capture, in order. The light pass reproduces the historical
// (pre-dark) screenshots; the dark pass is the added set. Each is written to a
// `<project>/<theme>/` subfolder.
const THEMES = ["light", "dark"] as const;

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
  /** Start-menu label; see MINI_APP_MENU_ITEMS in registry.ts. */
  menuLabel: string;
}

// Most windowed apps are opened from the footer Start menu. System Monitor is
// also available there, but its capture uses the persistent tray shortcut below
// so the screenshot suite covers both launcher surfaces.
const WINDOWED_MENU_APPS: readonly WindowedApp[] = [
  { name: "explorer", menuLabel: "Explorer" },
  { name: "contacts", menuLabel: "Contacts" },
  { name: "org-manager", menuLabel: "Org Manager" },
  { name: "notes", menuLabel: "Notes" },
  { name: "identity-manager", menuLabel: "Identity Manager" },
  { name: "backup-restore", menuLabel: "Backup / Restore" },
];

// Opens the backup-restore mini-app for whichever shell is rendered.
async function openBackupRestore(page: Page, routed: boolean): Promise<void> {
  if (routed) {
    await page.goto("/app/backup-restore");
    await waitForBooted(page);
    return;
  }
  await openWindowedApp(page, "Backup / Restore");
}

// Fails loudly if the restore + reload did not actually surface seeded data
// (wrong password/identity, tab race, schema drift), so we never emit blank
// screenshots that look "successful". Checks two independent read paths:
//  - Explorer lists the restored root, so the seeded driver's-license document is
//    a layout-independent signal the backup restored.
//  - Contacts reads the identity-scoped Contacts system container, so a seeded
//    contact there proves the imported identity re-derived that container's slot.
const SEEDED_CONTACT_NAME = "Alan Turing";

async function assertSeededDataVisible(
  page: Page,
  routed: boolean,
): Promise<void> {
  if (routed) {
    await page.goto("/app/explorer");
    await waitForBooted(page);
    await expect(page.getByText(/Driver's License/).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.goto("/app/contacts");
    await waitForBooted(page);
    await expect(page.getByText(SEEDED_CONTACT_NAME).first()).toBeVisible({
      timeout: 20_000,
    });
    return;
  }

  await openWindowedApp(page, "Explorer");
  const explorerPane = visiblePane(page);
  const explorerWindow = explorerPane.locator(".window").first();
  await expect(
    explorerWindow.getByText(/Driver's License/).first(),
  ).toBeVisible({
    timeout: 20_000,
  });
  await explorerWindow.locator(".window-close").click();
  await expect(explorerPane.locator(".window")).toHaveCount(0);

  await openWindowedApp(page, "Contacts");
  const contactsPane = visiblePane(page);
  const contactsWindow = contactsPane.locator(".window").first();
  await expect(
    contactsWindow.getByText(SEEDED_CONTACT_NAME).first(),
  ).toBeVisible({
    timeout: 20_000,
  });
  await contactsWindow.locator(".window-close").click();
  await expect(contactsPane.locator(".window")).toHaveCount(0);
}

async function captureRouted(page: Page, outputDir: string): Promise<void> {
  for (const screen of ROUTED_SCREENS) {
    // The caller already navigated + booted for the assertion, so skip the
    // redundant reload for whichever route we are already on. Normalize trailing
    // slashes so a router redirect (e.g. "/app/explorer/") is not treated as a
    // different route and re-navigated needlessly.
    const currentPath = new URL(page.url()).pathname.replace(/\/$/, "") || "/";
    const targetPath = screen.route.replace(/\/$/, "") || "/";
    if (currentPath !== targetPath) {
      await page.goto(screen.route);
      await waitForBooted(page);
    }
    await disableAnimations(page);
    if (screen.name === "org-manager") {
      await assertRoutedOrgManagerBaseCaptureReady(page);
    }
    await page.screenshot({
      path: path.join(outputDir, `${screen.name}.png`),
      fullPage: false,
    });
  }
}

// Screenshots the currently-open window (maximized for a large, uniform capture)
// and then closes it so the desktop is empty for the next app. When `onOpen` is
// given it runs after the window has settled and before the shot — used to click
// into a detail view.
async function captureOpenWindow(
  page: Page,
  outputDir: string,
  name: string,
  onOpen?: (window: Locator) => Promise<void>,
): Promise<void> {
  const pane = visiblePane(page);
  const window = pane.locator(".window").first();
  await window.waitFor({ state: "visible", timeout: 20_000 });
  // Disable animations before maximizing so the transition is instant and the
  // window is already at its final size before we wait on content.
  await disableAnimations(page);
  await window.locator(".window-maximize").click();
  // Let the freshly-mounted app's data queries resolve so content is not
  // captured mid-"Loading…". Best-effort; resolves immediately if absent.
  await window
    .getByText("Loading...")
    .first()
    .waitFor({ state: "hidden", timeout: 10_000 })
    .catch(() => {});
  if (onOpen) {
    await onOpen(window);
  }
  await window.screenshot({ path: path.join(outputDir, `${name}.png`) });
  await window.locator(".window-close").click();
  await expect(pane.locator(".window")).toHaveCount(0);
}

async function captureWindowed(page: Page, outputDir: string): Promise<void> {
  for (const app of WINDOWED_MENU_APPS) {
    await openWindowedApp(page, app.menuLabel);
    await captureOpenWindow(
      page,
      outputDir,
      app.name,
      app.name === "org-manager"
        ? (window) => assertOrgManagerCaptureReady(window, "directory")
        : undefined,
    );
  }

  // Exercise the persistent System Monitor tray shortcut; the Start-menu entry
  // uses the same unpin-then-open behavior.
  await visiblePane(page)
    .getByRole("button", { name: "System Monitor" })
    .click();
  await captureOpenWindow(page, outputDir, "system-monitor");
}

async function captureWindowedOrgManagerSections(
  page: Page,
  outputDir: string,
): Promise<void> {
  for (const screen of ORG_MANAGER_SCREENS) {
    await openWindowedApp(page, "Org Manager");
    await captureOpenWindow(page, outputDir, screen.name, async (window) => {
      await window
        .getByRole("button", { name: screen.label, exact: true })
        .click();
      await assertOrgManagerCaptureReady(window, screen.view);
    });
  }
}

// A detail screen is reached by clicking into a seeded item. Each `open` selects
// the item (scoped to the given page or window) and then waits for a signal that
// is present ONLY in the detail view, so a mis-click can never emit a list
// screenshot mislabeled as a detail. The same `open` drives both layouts, since
// Page and Locator share getByText/getByRole/locator.
type OpenDetail = (scope: Page | Locator) => Promise<void>;

// Notes: click a note row; the editor textarea then holds the note body.
const openNoteDetail: OpenDetail = async (scope) => {
  await scope
    .locator(".mini-app-row--button", { hasText: "Meeting notes" })
    .first()
    .click();
  const editor = scope.locator("textarea.note-document-editor");
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await expect(editor).toHaveValue(/Sync on the sync layer:/, {
    timeout: 20_000,
  });
};

// Contacts: click a contact row; the read detail shows the "Public key" field,
// which appears only in the detail (not the list or the new/import forms).
const openContactDetail: OpenDetail = async (scope) => {
  await scope
    .locator(".mini-app-row--button", { hasText: "Alan Turing" })
    .first()
    .click();
  await expect(scope.getByText("Public key").first()).toBeVisible({
    timeout: 20_000,
  });
};

// Driver's license: click its row in the Explorer folder-contents table (the
// `.explorer-item-row-button` name cell, present in both the routed and windowed
// layouts — the sidebar tree is windowed-only). The document detail renders the
// two license images (front + back) from blob URLs, which resolve async.
const openDriversLicenseDetail: OpenDetail = async (scope) => {
  await scope
    .locator(".explorer-item-row-button", {
      hasText: "Driver's License S123-4567-8901",
    })
    .first()
    .click();
  // The blob-backed previews resolve asynchronously; presence in the DOM is not
  // enough — wait until both have actually decoded so the shot never catches a
  // blank/half-loaded image.
  const images = scope.locator("img.structured-document-slot-preview-image");
  await expect(images).toHaveCount(2, { timeout: 20_000 });
  // Query each image via nth() rather than a captured all() snapshot, so a
  // re-render between assertions can't leave us holding a detached element.
  for (let i = 0; i < 2; i++) {
    const image = images.nth(i);
    await expect(image).toHaveJSProperty("complete", true);
    await expect(image).not.toHaveJSProperty("naturalWidth", 0);
  }
};

interface DetailScreen {
  /** Output file stem (`<name>.png`). */
  name: string;
  /** Routed URL of the mini-app whose detail is opened. */
  route: string;
  /** Footer-launcher label for the windowed shell. */
  menuLabel: string;
  open: OpenDetail;
}

const DETAIL_SCREENS: readonly DetailScreen[] = [
  {
    name: "note-detail",
    route: "/app/notes",
    menuLabel: "Notes",
    open: openNoteDetail,
  },
  {
    name: "contact-detail",
    route: "/app/contacts",
    menuLabel: "Contacts",
    open: openContactDetail,
  },
  {
    name: "drivers-license-detail",
    route: "/app/explorer",
    menuLabel: "Explorer",
    open: openDriversLicenseDetail,
  },
];

// Routed: navigate to the list, click into the detail, screenshot the viewport.
async function captureRoutedDetails(
  page: Page,
  outputDir: string,
): Promise<void> {
  for (const screen of DETAIL_SCREENS) {
    await page.goto(screen.route);
    await waitForBooted(page);
    // Disable animations before opening so the list->detail transition is
    // instantaneous; page.goto resets injected styles, so this must run per
    // iteration and before the interaction.
    await disableAnimations(page);
    await screen.open(page);
    await page.screenshot({
      path: path.join(outputDir, `${screen.name}.png`),
      fullPage: false,
    });
  }
}

// Windowed: open the app window, maximize, click into the detail, screenshot the
// window, then close it so the desktop is clear for the next one.
async function captureWindowedDetails(
  page: Page,
  outputDir: string,
): Promise<void> {
  for (const screen of DETAIL_SCREENS) {
    await openWindowedApp(page, screen.menuLabel);
    await captureOpenWindow(page, outputDir, screen.name, screen.open);
  }
}

// Pins the app to `theme` and reloads so it boots under that theme. The seeded
// DB persists across the reload (the per-identity DB file is untouched — only the
// theme choice key is added), so the same populated app is re-captured in the
// other theme. Hard-fails if `<html data-theme>` does not settle on the target,
// so a theme that silently failed to apply can never emit mislabeled shots.
async function applyTheme(page: Page, theme: string): Promise<void> {
  await setStoredTheme(page, theme);
  await page.reload();
  await waitForBooted(page);
  await page.waitForFunction(
    (expected) =>
      document.documentElement.getAttribute("data-theme") === expected,
    theme,
    { timeout: 20_000 },
  );
  // Re-inject after the reload (a full load resets injected styles) so the
  // capture phases start with animations already disabled.
  await disableAnimations(page);
}

test("capture screenshots", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const projectDir = path.join(REPO_ROOT, ".screenshots", project);
  const { screenshotApiBaseUrl } = testInfo.project.metadata;
  if (typeof screenshotApiBaseUrl !== "string") {
    throw new Error(`Missing screenshot API URL for project ${project}.`);
  }

  await page.goto("/");
  await waitForBooted(page);
  // Disable animations up front so the restore flow (tab switch, inputs) runs
  // instantly; the later reload resets injected styles, so it is re-applied then.
  await disableAnimations(page);
  const routed = (await page.locator(".routed-pane").count()) > 0;

  // Seed the DB in three steps:
  //  1. Import the artifact's fixed identity so restore writes into ITS database
  //     and its signing key re-derives the seeded Contacts container's slot.
  //  2. Restore the seed backup through the shipping backup-restore mini-app.
  //  3. Clear the stale session/caches so the reload adopts the restored root,
  //     then reload so the populated DB is reopened under the imported identity.
  await importSeedIdentity(page, routed, SEED_IDENTITY_PHRASE);
  await openBackupRestore(page, routed);
  await restoreSeedBackup(page, {
    artifactPath: SEED_ARTIFACT_PATH,
    password: SEED_PASSWORD,
  });
  await clearStaleLocalState(page);
  await page.reload();
  await waitForBooted(page);
  await authenticateOrRegisterScreenshotIdentity(
    screenshotApiBaseUrl,
    page,
    routed,
  );
  // Disable animations before asserting so a still-animating window/pane can't
  // flake the visibility check (capture phases re-inject after their navigations).
  await disableAnimations(page);
  await assertAuthenticatedOrgManager(page, routed);
  await assertSeededDataVisible(page, routed);

  // Capture a full set per theme into `<project>/<theme>/`. applyTheme reloads
  // between passes; the seeded DB survives, so each pass re-captures the same
  // populated app in the other theme.
  for (const theme of THEMES) {
    await applyTheme(page, theme);
    // A theme reload is also a fresh auth boundary. Re-establish (or confirm)
    // the session before every pass so both themes are captured from the same
    // authenticated organization state.
    await authenticateOrRegisterScreenshotIdentity(
      screenshotApiBaseUrl,
      page,
      routed,
    );
    await assertAuthenticatedOrgManager(page, routed);
    const outputDir = path.join(projectDir, theme);
    await mkdir(outputDir, { recursive: true });
    if (routed) {
      await captureRouted(page, outputDir);
      await captureRoutedOrgManagerSections(page, outputDir);
      await captureRoutedDetails(page, outputDir);
    } else {
      await captureWindowed(page, outputDir);
      await captureWindowedOrgManagerSections(page, outputDir);
      await captureWindowedDetails(page, outputDir);
    }
  }
});
