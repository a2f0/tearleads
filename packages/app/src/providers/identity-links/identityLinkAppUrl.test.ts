import { expect, test } from "bun:test";
import { identityLinkAppUrl } from "./identityLinkAppUrl";

test("native identity links point to the matching public web deployment", () => {
  for (const currentHref of [
    "capacitor://localhost/",
    "views://main/",
    "https://localhost/",
  ]) {
    expect(
      identityLinkAppUrl({
        apiBaseUrl: "https://api.tearleads.com",
        currentHref,
      }),
    ).toBe("https://app.tearleads.com");
    expect(
      identityLinkAppUrl({
        apiBaseUrl: "https://api-staging.tearleads.com",
        currentHref,
      }),
    ).toBe("https://app-staging.tearleads.com");
    expect(
      identityLinkAppUrl({
        apiBaseUrl: "https://custom-api.test",
        currentHref,
        configuredUrl: "https://custom-app.test",
      }),
    ).toBe("https://custom-app.test");
  }
});

test("web identity links retain the host origin for local and custom deployments", () => {
  expect(
    identityLinkAppUrl({
      apiBaseUrl: "/api",
      currentHref: "https://custom.test/app/contacts",
    }),
  ).toBe("https://custom.test");
  expect(
    identityLinkAppUrl({
      apiBaseUrl: "http://localhost:3001",
      currentHref: "http://localhost:3000/",
    }),
  ).toBe("http://localhost:3000");
  expect(() =>
    identityLinkAppUrl({
      apiBaseUrl: "https://custom-api.test",
      currentHref: "views://main/",
    }),
  ).toThrow("Configure the web app URL");
});
