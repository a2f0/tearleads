import { expect, test } from "bun:test";
import {
  MINI_APP_MENU_ITEMS,
  MINI_APPS,
  ROUTED_MINI_APP_NAV_ITEMS,
} from "./registry";
import { isMiniAppId } from "./types";

const appIds = (items: ReadonlyArray<{ appId: string }>) =>
  items.map((item) => item.appId);

test("the windowed pane menu includes system-monitor", () => {
  expect(appIds(MINI_APP_MENU_ITEMS)).toContain("system-monitor");
});

test("routed nav matches the windowed menu order", () => {
  expect(appIds(ROUTED_MINI_APP_NAV_ITEMS)).toEqual(
    appIds(MINI_APP_MENU_ITEMS),
  );
});

test("isMiniAppId accepts exactly the registered mini-app ids", () => {
  for (const appId of Object.keys(MINI_APPS)) {
    expect(isMiniAppId(appId)).toBe(true);
  }
  expect(isMiniAppId("not-a-mini-app")).toBe(false);
  expect(isMiniAppId(undefined)).toBe(false);
});
