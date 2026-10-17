import { expect, test } from "bun:test";
import { injectFaviconLinks } from "./injectFaviconLinks";

const links =
  '<link rel="icon" href="/favicon.ico" sizes="any" />' +
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />' +
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />';

test("adds the favicon links at the end of the head", () => {
  expect(
    injectFaviconLinks("<html><head><title>App</title></HEAD><body></body>"),
  ).toBe(`<html><head><title>App</title>${links}</head><body></body>`);
});

test("leaves a document that already links the favicon unchanged", () => {
  const html = `<html><head>${links}</head><body></body></html>`;
  expect(injectFaviconLinks(html)).toBe(html);
});

test("rejects a document without a head end tag", () => {
  expect(() => injectFaviconLinks("<html><body></body></html>")).toThrow(
    "No </head> found",
  );
});
