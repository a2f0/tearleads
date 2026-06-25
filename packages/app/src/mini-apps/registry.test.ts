import { expect, test } from "bun:test";
import { MINI_APP_MENU_ITEMS, ROUTED_MINI_APP_NAV_ITEMS } from "./registry";

const appIds = (items: ReadonlyArray<{ appId: string }>) =>
  items.map((item) => item.appId);

test("the windowed pane menu omits system-monitor (it lives in the footer tray)", () => {
  expect(appIds(MINI_APP_MENU_ITEMS)).not.toContain("system-monitor");
});

test("the routed nav surfaces system-monitor since it has no footer tray", () => {
  expect(appIds(ROUTED_MINI_APP_NAV_ITEMS)).toContain("system-monitor");
});

test("routed nav is the windowed menu plus system-monitor, order preserved", () => {
  expect(appIds(ROUTED_MINI_APP_NAV_ITEMS)).toEqual([
    ...appIds(MINI_APP_MENU_ITEMS),
    "system-monitor",
  ]);
});
