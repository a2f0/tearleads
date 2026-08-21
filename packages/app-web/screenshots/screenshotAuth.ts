import { expect, type Locator, type Page } from "@playwright/test";
import { openWindowedApp, visiblePane, waitForBooted } from "./appShell";
import {
  assertOrgManagerAuthGuardAbsent,
  assertOrgManagerCaptureReady,
} from "./orgManagerScreens";

interface OpenIdentityManagerResult {
  readonly close: () => Promise<void>;
  readonly scope: Locator | Page;
}

const LOCAL_SESSION_STORAGE_PREFIX = "symcrypt.local-session:";

async function readPersistedSessionSnapshot(page: Page): Promise<string> {
  return page.evaluate((prefix) => {
    return JSON.stringify(
      Object.keys(localStorage)
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((key) => [key, localStorage.getItem(key)]),
    );
  }, LOCAL_SESSION_STORAGE_PREFIX);
}

async function waitForPersistedSessionUpdate(
  page: Page,
  before: string,
): Promise<void> {
  let latest = before;
  let sawUpdate = false;
  let stablePolls = 0;

  await expect
    .poll(
      async () => {
        const current = await readPersistedSessionSnapshot(page);
        if (current !== latest) {
          latest = current;
          sawUpdate = current !== before;
          stablePolls = 0;
          return false;
        }
        if (!sawUpdate) {
          return false;
        }
        stablePolls += 1;
        return stablePolls >= 3;
      },
      {
        intervals: [500],
        message: "authenticated screenshot session persisted",
        timeout: 30_000,
      },
    )
    .toBe(true);
}

async function openIdentityManager(
  page: Page,
  routed: boolean,
): Promise<OpenIdentityManagerResult> {
  if (routed) {
    // Route to the section that carries the identity details this reads (the
    // Signing Key row, the Login/Register buttons). The mini-app's base route is
    // its section menu, which the tablet tier resolves to General but the mobile
    // tier leaves as the menu itself — so ask for General by name.
    await page.goto("/app/identity-manager/general");
    await waitForBooted(page);
    return { close: async () => undefined, scope: page };
  }

  await openWindowedApp(page, "Identity Manager");
  const pane = visiblePane(page);
  const window = pane.locator(".window").first();
  await window.waitFor({ state: "visible", timeout: 20_000 });
  return {
    close: async () => {
      await window.locator(".window-close").click();
      await expect(pane.locator(".window")).toHaveCount(0);
    },
    scope: window,
  };
}

async function identityIsRegistered(
  apiBaseUrl: string,
  page: Page,
  scope: Locator | Page,
): Promise<boolean> {
  const signingFingerprint = await scope
    .locator("dt", { hasText: "Signing Key" })
    .locator("xpath=following-sibling::dd[1]")
    .locator(".identity-manager-detail-text")
    .getAttribute("title");
  if (!signingFingerprint) {
    throw new Error(
      "Screenshot identity did not expose a signing fingerprint.",
    );
  }

  // Probe from Playwright rather than trying Login first. A failed UI login is
  // intentionally logged by the app and would make the System Monitor screenshot
  // look unhealthy even though first-run registration is the expected next step.
  const response = await page.request.post(`${apiBaseUrl}/auth/challenge`, {
    data: { fingerprint: signingFingerprint },
  });
  if (response.status() === 200) {
    return true;
  }
  if (response.status() === 404) {
    return false;
  }
  throw new Error(
    `Screenshot identity registration probe failed with ${response.status()}.`,
  );
}

/**
 * Authenticate the restored fixed identity, registering it against a fresh
 * project-scoped API or logging in when a retry has already registered it.
 */
export async function authenticateOrRegisterScreenshotIdentity(
  apiBaseUrl: string,
  page: Page,
  routed: boolean,
): Promise<void> {
  const { close, scope } = await openIdentityManager(page, routed);
  const authenticated = scope.getByText("Authenticated", { exact: true });
  let persistedSessionBefore: string | null = null;

  if (!(await authenticated.isVisible())) {
    persistedSessionBefore = await readPersistedSessionSnapshot(page);
    if (await identityIsRegistered(apiBaseUrl, page, scope)) {
      const login = scope.getByRole("button", { name: "Login", exact: true });
      await expect(login).toBeVisible({ timeout: 20_000 });
      await login.click();
    } else {
      const register = scope.getByRole("button", {
        name: "Register",
        exact: true,
      });
      await expect(register).toBeEnabled({ timeout: 20_000 });
      await register.click();
    }
  }

  await expect(authenticated).toBeVisible({ timeout: 60_000 });
  const organizationValue = scope
    .locator("dt", { hasText: "Organization ID" })
    .locator("xpath=following-sibling::dd[1]");
  await expect(organizationValue).not.toHaveText("None", { timeout: 20_000 });
  if (persistedSessionBefore !== null) {
    // Registration writes a non-authenticated identity context before the
    // challenge login writes the token-bearing context. Wait until the queued
    // encrypted local-session writes have both advanced and settled; otherwise
    // an immediate navigation can reboot from the intermediate signed-out
    // record even though Identity Manager already paints "Authenticated".
    await waitForPersistedSessionUpdate(page, persistedSessionBefore);
  }
  await close();

  // Registration/login updates the live Identity Manager immediately, while
  // other mini-app providers can still hold the signed-out snapshot from this
  // boot. Reboot the shell across this auth boundary so Org Manager consumes
  // the persisted authenticated session rather than racing that stale state.
  await page.reload();
  await waitForBooted(page);
}

/** Prove Org Manager is rendering its authenticated navigation, not its guard. */
export async function assertAuthenticatedOrgManager(
  page: Page,
  routed: boolean,
): Promise<void> {
  let scope: Locator | Page = page;
  let close: () => Promise<void> = async () => undefined;

  if (routed) {
    await page.goto("/app/org-manager");
    await waitForBooted(page);
  } else {
    await openWindowedApp(page, "Org Manager");
    const pane = visiblePane(page);
    const window = pane.locator(".window").first();
    await window.waitFor({ state: "visible", timeout: 20_000 });
    scope = window;
    close = async () => {
      await window.locator(".window-close").click();
      await expect(pane.locator(".window")).toHaveCount(0);
    };
  }

  const roster = scope.getByRole("button", { name: "Roster", exact: true });
  await expect(roster).toBeVisible({ timeout: 30_000 });
  await expect(
    scope.getByRole("button", { name: "Groups", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await assertOrgManagerAuthGuardAbsent(scope);
  await roster.click();
  await assertOrgManagerCaptureReady(scope, "directory");
  // A freshly registered identity can briefly render the local-cache miss while
  // the realtime interest handshake fetches the first remote read-model page.
  // Prove the hydrated roster first, then reject any error that survived it.
  await expect(
    scope.getByText("Failed to load organization roster or groups."),
  ).toHaveCount(0);
  await close();
}
