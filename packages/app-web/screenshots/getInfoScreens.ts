import { expect, type Locator, type Page } from "@playwright/test";
import { seedExpectations } from "./continuity";

/*
 * Explorer Get Info, opened from an item's row actions: the key/value panels
 * (General) and a multi-column table that has rows without a sign-in (a
 * seeded document's attachments). They read differently on every layout —
 * keys beside values on a wide pane, stacked on a phone; tables folded into
 * two-line rows on a phone — so each layout's capture is the record of it.
 */

type Scope = Page | Locator;

/**
 * Opens Get Info from the row's actions and waits until it has loaded: the
 * panel draws its id row before the info arrives, so wait for `loadedKey`, a
 * row that only has a value once it has.
 */
async function openItemInfo(
  scope: Scope,
  title: string,
  loadedKey: string,
): Promise<void> {
  const actions = scope.getByRole("button", {
    name: `Actions for ${title}`,
    exact: true,
  });
  await expect(actions).toHaveCount(1, { timeout: 20_000 });
  await actions.click();
  // The row menu portals to the document body, outside a window scope.
  const page = "page" in scope ? scope.page() : scope;
  await page
    .locator(".menu")
    .last()
    .getByRole("button", { name: "Get Info", exact: true })
    .click();
  const panel = scope.getByRole("tabpanel");
  const loadedValue = panel
    .locator("dt")
    .filter({ hasText: new RegExp(`^${loadedKey}$`, "u") })
    .locator("xpath=following-sibling::dd[1]");
  await expect(loadedValue).toBeVisible({ timeout: 20_000 });
  await expect(loadedValue).not.toHaveText("-", { timeout: 20_000 });
  await expect(panel.getByText("Loading...")).toHaveCount(0, {
    timeout: 20_000,
  });
  // The menu item was under the pointer, and the panel opens with a copyable
  // id there; park the pointer on a heading so no value captures hovered.
  await panel.getByRole("heading").first().hover();
}

function openInfoTab(title: string, tab: string, table: string) {
  return async (scope: Scope) => {
    await openItemInfo(scope, title, "Type");
    await scope.getByRole("tab", { name: tab, exact: true }).click();
    await expect(
      scope.getByRole("table", { name: table }).locator("tbody > tr").first(),
    ).toBeVisible({ timeout: 20_000 });
  };
}

const creditCard = seedExpectations.creditCard.title;

export const GET_INFO_SCREENS = [
  {
    name: "container-info",
    open: (scope: Scope) => openItemInfo(scope, "Contacts", "Created"),
  },
  {
    name: "document-info",
    open: (scope: Scope) => openItemInfo(scope, creditCard, "Type"),
  },
  {
    name: "document-info-blobs",
    open: openInfoTab(creditCard, "Blobs", "Attachments & Blobs"),
  },
].map((screen) => ({
  ...screen,
  route: "/app/explorer",
  menuLabel: "Explorer",
}));
