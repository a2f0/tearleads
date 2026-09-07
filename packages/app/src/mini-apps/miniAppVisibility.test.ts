import { expect, test } from "bun:test";
import {
  filterVisibleMiniAppItems,
  isMiniAppVisible,
} from "./miniAppVisibility";
import { MINI_APP_MENU_ITEMS, ROUTED_MINI_APP_NAV_ITEMS } from "./registry";

const appIds = (items: ReadonlyArray<{ appId: string }>) =>
  items.map((item) => item.appId);

test("the root mini-app is offered only to root sessions", () => {
  expect(isMiniAppVisible("root", { isRoot: false })).toBe(false);
  expect(isMiniAppVisible("root", { isRoot: true })).toBe(true);
  expect(isMiniAppVisible("org-manager", { isRoot: false })).toBe(true);
});

test("filtering hides root from the launcher and routed nav alike", () => {
  const hiddenMenu = appIds(
    filterVisibleMiniAppItems(MINI_APP_MENU_ITEMS, { isRoot: false }),
  );
  const hiddenNav = appIds(
    filterVisibleMiniAppItems(ROUTED_MINI_APP_NAV_ITEMS, { isRoot: false }),
  );
  expect(hiddenMenu).not.toContain("root");
  expect(hiddenNav).toEqual(hiddenMenu);

  const shownMenu = appIds(
    filterVisibleMiniAppItems(MINI_APP_MENU_ITEMS, { isRoot: true }),
  );
  expect(shownMenu).toEqual(appIds(MINI_APP_MENU_ITEMS));
  expect(shownMenu).toContain("root");
});
