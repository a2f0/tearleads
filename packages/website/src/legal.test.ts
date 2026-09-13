import { expect, test } from "bun:test";
import { legalDetails, shouldShowLegalDocument } from "./legal";

test("unapproved documents are hidden in ordinary and production builds", () => {
  for (const environment of ["production", "unknown", undefined]) {
    expect(
      shouldShowLegalDocument({
        isDraft: true,
        isDevelopment: false,
        environment,
      }),
    ).toBe(false);
  }
});

test("drafts are available for local development and staging review", () => {
  for (const [isDevelopment, environment] of [
    [true, undefined],
    [false, "staging"],
    [true, "staging"],
  ] as const) {
    expect(
      shouldShowLegalDocument({ isDraft: true, isDevelopment, environment }),
    ).toBe(true);
  }
});

test("an explicit production environment never exposes drafts", () => {
  expect(
    shouldShowLegalDocument({
      isDraft: true,
      isDevelopment: true,
      environment: "production",
    }),
  ).toBe(false);
});

test("approved documents are visible in production", () => {
  expect(
    shouldShowLegalDocument({
      isDraft: false,
      isDevelopment: false,
      environment: "production",
    }),
  ).toBe(true);
});

test("the human-readable legal date is derived from the ISO date in UTC", () => {
  const date = new Date(`${legalDetails.updatedAt}T00:00:00Z`);
  expect(date.toISOString().slice(0, 10)).toBe(legalDetails.updatedAt);
  expect(legalDetails.updatedLabel).toBe(
    date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }),
  );
});
