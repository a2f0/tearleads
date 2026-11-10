import { expect, test } from "bun:test";
import { mediaForColorScheme } from "./colorSchemeMedia";

test("a lone scheme feature becomes all or not all", () => {
  expect(mediaForColorScheme("(prefers-color-scheme: dark)", "dark")).toBe(
    "all",
  );
  expect(mediaForColorScheme("(prefers-color-scheme: dark)", "light")).toBe(
    "not all",
  );
  expect(mediaForColorScheme("(prefers-color-scheme: light)", "light")).toBe(
    "all",
  );
});

test("other conditions in the query survive the scheme decision", () => {
  const phoneDark = "(max-width: 699px) and (prefers-color-scheme: dark)";
  expect(mediaForColorScheme(phoneDark, "dark")).toBe("(max-width: 699px)");
  expect(mediaForColorScheme(phoneDark, "light")).toBe("not all");
});

test("each query in a list is decided on its own", () => {
  expect(
    mediaForColorScheme(
      "(prefers-color-scheme: dark), (min-width: 700px)",
      "light",
    ),
  ).toBe("(min-width: 700px)");
  expect(
    mediaForColorScheme("print, (prefers-color-scheme: dark)", "dark"),
  ).toBe("print, all");
});
