import { expect, test } from "bun:test";
import { MINI_APPS } from "./registry";
import { isMiniAppId } from "./types";

test("isMiniAppId accepts exactly the registered mini-app ids", () => {
  for (const appId of Object.keys(MINI_APPS)) {
    expect(isMiniAppId(appId)).toBe(true);
  }
  expect(isMiniAppId("not-a-mini-app")).toBe(false);
  expect(isMiniAppId(undefined)).toBe(false);
});
