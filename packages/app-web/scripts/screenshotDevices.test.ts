import { expect, test } from "bun:test";
import { devices } from "@playwright/test";
import config from "../playwright.screenshots.config";

test("phone captures keep the iPhone 13 profile at its full 390x844 screen", () => {
  const phones = (config.projects ?? []).filter((project) =>
    ["mobile", "blame-mobile"].includes(project.name ?? ""),
  );
  expect(phones.map((project) => project.name)).toEqual([
    "mobile",
    "blame-mobile",
  ]);
  const iPhone = devices["iPhone 13"];
  for (const phone of phones) {
    expect(phone.use?.viewport).toEqual({ width: 390, height: 844 });
    expect(phone.use?.screen).toEqual({ width: 390, height: 844 });
    expect(phone.use?.deviceScaleFactor).toBe(3);
    expect(phone.use?.userAgent).toBe(iPhone.userAgent);
    expect(phone.use?.isMobile).toBe(true);
    expect(phone.use?.hasTouch).toBe(true);
  }
});
