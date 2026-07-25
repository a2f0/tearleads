import * as path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { disableAnimations, waitForBooted } from "./appShell";

type ScreenshotOrgManagerView =
  | "menu"
  | "directory"
  | "groups"
  | "grants"
  | "organization"
  | "usage"
  | "billing";

interface OrgManagerScreen {
  /** Sidebar label used by the windowed layout. */
  label: string;
  /** Output file stem (`<name>.png`). */
  name: string;
  /** Direct route used by every routed layout (phone and tablet). */
  route: string;
  view: Exclude<ScreenshotOrgManagerView, "menu">;
}

export const ORG_MANAGER_SCREENS: readonly OrgManagerScreen[] = [
  {
    label: "Roster",
    name: "org-manager-roster",
    route: "/app/org-manager/directory",
    view: "directory",
  },
  {
    label: "Groups",
    name: "org-manager-groups",
    route: "/app/org-manager/groups",
    view: "groups",
  },
  {
    label: "Grants",
    name: "org-manager-grants",
    route: "/app/org-manager/grants",
    view: "grants",
  },
  {
    label: "Organization",
    name: "org-manager-organization",
    route: "/app/org-manager/organization",
    view: "organization",
  },
  {
    label: "Usage",
    name: "org-manager-usage",
    route: "/app/org-manager/usage",
    view: "usage",
  },
  {
    label: "Billing",
    name: "org-manager-billing",
    route: "/app/org-manager/billing",
    view: "billing",
  },
];

const ORG_MANAGER_AUTH_GUARD = "Authenticate to manage an organization.";

export async function assertOrgManagerAuthGuardAbsent(
  scope: Locator | Page,
): Promise<void> {
  await expect(
    scope.getByText(ORG_MANAGER_AUTH_GUARD, { exact: true }),
  ).toHaveCount(0);
}

/**
 * Wait for an authenticated Org Manager surface to finish loading the exact
 * section that is about to be captured. The content signals intentionally come
 * from inside each section rather than its navigation button, so a stale menu,
 * an auth guard, or a half-loaded request cannot produce a mislabeled image.
 */
export async function assertOrgManagerCaptureReady(
  scope: Locator | Page,
  view: ScreenshotOrgManagerView,
): Promise<void> {
  await assertOrgManagerAuthGuardAbsent(scope);

  switch (view) {
    case "menu":
      await expect(
        scope.getByRole("navigation", { name: "Org Manager sections" }),
      ).toBeVisible({ timeout: 30_000 });
      break;
    case "directory": {
      const roster = scope.getByRole("table", { name: "Roster", exact: true });
      await expect(roster).toContainText("You", {
        timeout: 60_000,
      });
      await expect(roster).toBeVisible({ timeout: 60_000 });
      break;
    }
    case "groups": {
      const groups = scope.getByRole("table", { name: "Groups", exact: true });
      await expect(groups).toContainText("Admins", {
        timeout: 60_000,
      });
      await expect(groups).toBeVisible({ timeout: 60_000 });
      break;
    }
    case "grants":
      await expect(
        scope.getByRole("table", {
          name: "Group container links",
          exact: true,
        }),
      ).toBeVisible({ timeout: 60_000 });
      break;
    case "organization":
      await expect(
        scope.getByText("Organization policy history", { exact: true }).first(),
      ).toBeVisible({ timeout: 60_000 });
      await expect(
        scope.getByText("Loading organization profile...", { exact: true }),
      ).toHaveCount(0, { timeout: 60_000 });
      await expect(
        scope.getByText("Organization name", { exact: true }).first(),
      ).toBeVisible({ timeout: 60_000 });
      break;
    case "usage":
      await expect(
        scope.getByText("Synced data usage", { exact: true }).first(),
      ).toBeVisible({ timeout: 60_000 });
      break;
    case "billing":
      await expect(
        scope.getByText("Sync billing", { exact: true }).first(),
      ).toBeVisible({ timeout: 60_000 });
      break;
  }

  await assertOrgManagerAuthGuardAbsent(scope);
}

/** The base route is a menu on phones and a roster on the tablet routed tier. */
export async function assertRoutedOrgManagerBaseCaptureReady(
  page: Page,
): Promise<void> {
  const compactMenu = await page.locator(".routed-pane--mobile").isVisible();
  await assertOrgManagerCaptureReady(page, compactMenu ? "menu" : "directory");
}

export async function captureRoutedOrgManagerSections(
  page: Page,
  outputDir: string,
): Promise<void> {
  // Enter Org Manager once and use its own navigation. A hard page load for
  // every section tears down its provider and can discard the freshly-created,
  // not-yet-synced organization profile before the next route boots.
  await page.goto("/app/org-manager");
  await waitForBooted(page);
  await disableAnimations(page);
  const compact = await page.locator(".routed-pane--mobile").isVisible();
  for (const screen of ORG_MANAGER_SCREENS) {
    const sectionButton = page.getByRole("button", {
      name: screen.label,
      exact: true,
    });
    if (!(await sectionButton.isVisible())) {
      await page
        .getByRole("button", { name: "Show Sidebar", exact: true })
        .click();
      await expect(sectionButton).toBeVisible({ timeout: 30_000 });
    }
    await sectionButton.click();
    await expect(page).toHaveURL(new RegExp(`${screen.route}/?$`));
    if (compact) {
      const closeSidebar = page.getByRole("button", {
        name: "Close sidebar",
        exact: true,
      });
      if (await closeSidebar.isVisible()) {
        // The scrim spans the viewport underneath the drawer, so its geometric
        // center is covered by the drawer itself. Invoke its registered close
        // action directly, then prove the overlay left before capture.
        await closeSidebar.evaluate((element) => {
          if (!(element instanceof HTMLButtonElement)) {
            throw new Error("Expected the sidebar scrim to be a button.");
          }
          element.click();
        });
        await expect(closeSidebar).toBeHidden({ timeout: 30_000 });
      }
    }
    await assertOrgManagerCaptureReady(page, screen.view);
    await page.screenshot({
      path: path.join(outputDir, `${screen.name}.png`),
      fullPage: false,
    });
  }
}
