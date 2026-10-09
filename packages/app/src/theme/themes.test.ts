import { expect, test } from "bun:test";
import { APP_THEMES } from "./themes";

test("the app offers Light, Dark, then Dusk, each with its scheme", () => {
  expect(APP_THEMES).toEqual([
    { id: "light", label: "Light", scheme: "light" },
    { id: "dark", label: "Dark", scheme: "dark" },
    { id: "dusk", label: "Dusk", scheme: "dark" },
  ]);
});
