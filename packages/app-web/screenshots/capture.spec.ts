import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import {
  clearStaleLocalState,
  disableAnimations,
  openWindowedApp,
  visiblePane,
  waitForBooted,
} from "./appShell";
import { importSeedIdentity } from "./seedIdentity";
import { restoreSeedBackup } from "./seedRestore";

// This file lives at packages/app-web/screenshots/, so the repo root is three
// levels up. Screenshots are written to `<repoRoot>/.screenshots/<project>/`.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

// The seed fixture drives both the committed artifact and this run. Regenerate
// the artifact with `bun run screenshots:seed` after editing the fixture.
const SEED_FIXTURES_DIR = path.join(
  REPO_ROOT,
  "packages/app/test/screenshot-seed/fixtures",
);
const SEED_ARTIFACT_PATH = path.join(
  SEED_FIXTURES_DIR,
  "tearleads-seed.tlbackup.json",
);
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
  await window.screenshot({ path: path.join(outputDir, `${name}.png`) });
  await window.locator(".window-close").click();
  await expect(pane.locator(".window")).toHaveCount(0);
}

async function captureWindowed(page: Page, outputDir: string): Promise<void> {
  for (const app of WINDOWED_MENU_APPS) {
    await openWindowedApp(page, app.menuLabel);
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
  // Disable animations up front so the restore flow (tab switch, inputs) runs
  // instantly; the later reload resets injected styles, so it is re-applied then.
  await disableAnimations(page);
  const routed = (await page.locator(".routed-pane").count()) > 0;

  // Seed the DB in three steps:
  //  1. Import the artifact's fixed identity so restore writes into ITS database
  //     and its signing key re-derives the seeded Contacts container's slot.
  //  2. Restore the committed backup through the shipping backup-restore mini-app.
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
  // Disable animations before asserting so a still-animating window/pane can't
  // flake the visibility check (capture phases re-inject after their navigations).
  await disableAnimations(page);
  await assertSeededDataVisible(page, routed);

  if (routed) {
    await captureRouted(page, outputDir);
  } else {
    await captureWindowed(page, outputDir);
  }
});
