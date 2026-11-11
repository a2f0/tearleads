import { expect, test } from "bun:test";
import {
  readApiIdentityTrustDomain,
  resolveApiIdentityTrustDomain,
} from "./apiIdentityTrustDomain";

test("identity trust domain preserves a canonical configured API base path", () => {
  expect(
    readApiIdentityTrustDomain({
      API_IDENTITY_TRUST_DOMAIN: " HTTPS://API.example.test:443/v1/ ",
    }),
  ).toBe("https://api.example.test/v1");
});

test("identity trust domain defaults to configured public origin", () => {
  expect(
    readApiIdentityTrustDomain({
      API_PUBLIC_ORIGIN: "https://api.example.test/",
      NODE_ENV: "production",
    }),
  ).toBe("https://api.example.test");
  expect(
    readApiIdentityTrustDomain({
      API_IDENTITY_TRUST_DOMAIN: "https://identity.example.test/api",
      API_PUBLIC_ORIGIN: "https://api.example.test",
      NODE_ENV: "production",
    }),
  ).toBe("https://identity.example.test/api");
});

test("production never derives identity scope from an untrusted request host", () => {
  expect(() => readApiIdentityTrustDomain({ NODE_ENV: "production" })).toThrow(
    "API_PUBLIC_ORIGIN is required",
  );
  expect(() =>
    readApiIdentityTrustDomain({
      NODE_ENV: "production",
      API_IDENTITY_TRUST_DOMAIN: "http://api.example.test",
    }),
  ).toThrow("https");
  expect(
    resolveApiIdentityTrustDomain(
      "https://canonical.example.test/base",
      "https://evil.example.test",
    ),
  ).toBe("https://canonical.example.test/base");
});

test("development fallback needs an explicit request origin", () => {
  expect(readApiIdentityTrustDomain({ NODE_ENV: "test" })).toBeNull();
  expect(
    resolveApiIdentityTrustDomain(null, "http://localhost:3001/auth/register"),
  ).toBe("http://localhost:3001");
  expect(() => resolveApiIdentityTrustDomain(null)).toThrow(
    "Identity trust domain requires",
  );
});

test("configured identity domains reject URL ambiguity instead of truncating it", () => {
  for (const domain of [
    "api.test",
    "wss://api.test",
    "https://user:secret@api.test",
    "https://api.test/?tenant=a",
    "https://api.test/#fragment",
  ]) {
    expect(() =>
      readApiIdentityTrustDomain({ API_IDENTITY_TRUST_DOMAIN: domain }),
    ).toThrow("API_IDENTITY_TRUST_DOMAIN");
  }
});
