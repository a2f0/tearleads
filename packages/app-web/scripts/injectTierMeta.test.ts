import { expect, test } from "bun:test";
import {
  injectTierMeta,
  PRODUCTION_URL_TAGS,
  STAGING_ROBOTS_META,
} from "./injectTierMeta";

const shell = "<html><head><title>App</title></HEAD><body></body></html>";
const withTags = (tags: string) =>
  `<html><head><title>App</title>${tags}</head><body></body></html>`;

test("production builds name the app root", () => {
  expect(injectTierMeta(shell, "prod")).toBe(withTags(PRODUCTION_URL_TAGS));
});

test("staging builds name no URL and ask not to be indexed", () => {
  const html = injectTierMeta(shell, "staging");
  expect(html).toBe(withTags(STAGING_ROBOTS_META));
  expect(html).not.toContain("canonical");
  expect(html).not.toContain("og:url");
});

test.each(["", undefined])("local %p builds get no tier tags", (tier) => {
  expect(injectTierMeta(shell, tier)).toBe(shell);
});

test.each(["prod", "staging"])("%s injection is idempotent", (tier) => {
  const once = injectTierMeta(shell, tier);
  expect(injectTierMeta(once, tier)).toBe(once);
});

test("a build carrying another tier's tags fails", () => {
  const staging = injectTierMeta(shell, "staging");
  const production = injectTierMeta(shell, "prod");
  expect(() => injectTierMeta(staging, "prod")).toThrow("Unexpected tier tag");
  expect(() => injectTierMeta(production, "staging")).toThrow(
    "Unexpected tier tag",
  );
  expect(() => injectTierMeta(staging, undefined)).toThrow(
    "Unexpected tier tag",
  );
});

test("unknown tiers and documents without a head fail", () => {
  expect(() => injectTierMeta(shell, "production")).toThrow(
    "APP_WEB_TIER must be prod or staging",
  );
  expect(() => injectTierMeta("<html><body></body></html>", "staging")).toThrow(
    "No </head> found",
  );
});
