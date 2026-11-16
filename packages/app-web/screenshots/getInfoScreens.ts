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

async function openItemInfo(scope: Scope, title: string): Promise<void> {
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
  await expect(
    scope.getByRole("tabpanel").locator("dl dt").first(),
  ).toBeVisible({ timeout: 20_000 });
}

function openInfoTab(title: string, tab: string, table: string) {
  return async (scope: Scope) => {
    await openItemInfo(scope, title);
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
    open: (scope: Scope) => openItemInfo(scope, "Contacts"),
  },
  {
    name: "document-info",
    open: (scope: Scope) => openItemInfo(scope, creditCard),
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
