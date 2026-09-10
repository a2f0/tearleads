import { expect, test } from "bun:test";
import { resolveIdentityTrustDomain } from "./trustDomain";

test("identity trust domains preserve long internal slash runs", () => {
  const apiBaseUrl = `https://example.test/${"/".repeat(100_000)}x`;
  expect(resolveIdentityTrustDomain({ apiBaseUrl })).toBe(apiBaseUrl);
  expect(resolveIdentityTrustDomain({ apiBaseUrl: `${apiBaseUrl}///` })).toBe(
    apiBaseUrl,
  );
}, 1_000);

test("identity trust domains canonicalize authority and retain API base path", () => {
  expect(
    resolveIdentityTrustDomain({
      apiBaseUrl: "HTTPS://API.Example.Test:443/v1/../api///",
    }),
  ).toBe("https://api.example.test/api");
});

test("relative identity trust domains require and use a host origin", () => {
  expect(
    resolveIdentityTrustDomain({
      ambientHref: "https://app.example.test/workspace",
      apiBaseUrl: "/api/v1/",
    }),
  ).toBe("https://app.example.test/api/v1");
  expect(
    resolveIdentityTrustDomain({ ambientHref: null, apiBaseUrl: "/api/v1" }),
  ).toBeNull();
  expect(
    resolveIdentityTrustDomain({
      ambientHref: "about:blank",
      apiBaseUrl: "/api/v1",
    }),
  ).toBeNull();
});

test("explicit identity trust domain overrides relative transport config", () => {
  expect(
    resolveIdentityTrustDomain({
      ambientHref: null,
      apiBaseUrl: "/api/v1",
      identityTrustDomain: "https://tenant.example.test/api/v1/",
    }),
  ).toBe("https://tenant.example.test/api/v1");
});

test("identity trust domains reject mutable or non-HTTP authority inputs", () => {
  for (const identityTrustDomain of [
    "file:///tmp/api",
    "https://user:secret@api.example.test/v1",
    "https://api.example.test/v1?tenant=one",
    "https://api.example.test/v1#identity",
  ]) {
    expect(() =>
      resolveIdentityTrustDomain({
        apiBaseUrl: "",
        identityTrustDomain,
      }),
    ).toThrow();
  }
});
