import { expect, test } from "bun:test";
import { DEFAULT_THEME_ID, getTheme, isThemeId, nextThemeId } from "./themes";

test("nextThemeId advances to the next theme and wraps around", () => {
  expect(nextThemeId("light")).toBe("dark");
  expect(nextThemeId("dark")).toBe("dusk");
  expect(nextThemeId("dusk")).toBe("light");
});

test("nextThemeId cycles the whole registry in a stable order", () => {
  let id = DEFAULT_THEME_ID;
  const cycle = [id];
  for (let i = 0; i < 6; i += 1) {
    id = nextThemeId(id);
    cycle.push(id);
  }
  expect(cycle).toEqual([
    "light",
    "dark",
    "dusk",
    "light",
    "dark",
    "dusk",
    "light",
  ]);
});

test("isThemeId accepts registered ids and rejects everything else", () => {
  expect(isThemeId("light")).toBe(true);
  expect(isThemeId("dark")).toBe(true);
  expect(isThemeId("dusk")).toBe(true);
  expect(isThemeId("solarized")).toBe(false);
  expect(isThemeId("")).toBe(false);
  expect(isThemeId(null)).toBe(false);
  expect(isThemeId(undefined)).toBe(false);
});

test("getTheme resolves each id to its labelled definition and scheme", () => {
  expect(getTheme("light")).toEqual({
    id: "light",
    label: "Light",
    scheme: "light",
  });
  expect(getTheme("dark")).toEqual({
    id: "dark",
    label: "Dark",
    scheme: "dark",
  });
  expect(getTheme("dusk")).toEqual({
    id: "dusk",
    label: "Dusk",
    scheme: "dark",
  });
});

test("DEFAULT_THEME_ID is itself a registered theme", () => {
  expect(isThemeId(DEFAULT_THEME_ID)).toBe(true);
  expect(getTheme(DEFAULT_THEME_ID).id).toBe(DEFAULT_THEME_ID);
});
