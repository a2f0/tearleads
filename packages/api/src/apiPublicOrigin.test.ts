import { expect, test } from "bun:test";
import {
  apiPublicOriginFallbackWarning,
  readApiPublicOrigin,
} from "./apiPublicOrigin";

test("a configured public origin is canonicalized", () => {
  expect(
    readApiPublicOrigin({ API_PUBLIC_ORIGIN: " https://api.example.test/ " }),
  ).toBe("https://api.example.test");
  expect(
    readApiPublicOrigin({ API_PUBLIC_ORIGIN: "HTTPS://API.example.test:443" }),
  ).toBe("https://api.example.test");
});

test("production requires a public origin", () => {
  expect(() => readApiPublicOrigin({ NODE_ENV: "production" })).toThrow(
    "API_PUBLIC_ORIGIN is required when NODE_ENV=production",
  );
  expect(
    readApiPublicOrigin({
      API_PUBLIC_ORIGIN: "https://api.example.test",
      NODE_ENV: "production",
    }),
  ).toBe("https://api.example.test");
});

test("production requires an https public origin", () => {
  expect(() =>
    readApiPublicOrigin({
      API_PUBLIC_ORIGIN: "http://api.example.test",
      NODE_ENV: "production",
    }),
  ).toThrow("API_PUBLIC_ORIGIN must use https when NODE_ENV=production");
  expect(
    readApiPublicOrigin({ API_PUBLIC_ORIGIN: "http://localhost:3001" }),
  ).toBe("http://localhost:3001");
});

test("a malformed public origin names the variable", () => {
  expect(() => readApiPublicOrigin({ API_PUBLIC_ORIGIN: "api.test" })).toThrow(
    "API_PUBLIC_ORIGIN must be an absolute URL",
  );
  expect(() =>
    readApiPublicOrigin({ API_PUBLIC_ORIGIN: "wss://api.example.test" }),
  ).toThrow("API_PUBLIC_ORIGIN must use http or https");
});

test("a public origin with more than an origin is refused, not truncated", () => {
  for (const configured of [
    "https://api.example.test/v1",
    "https://api.example.test/?tenant=a",
    "https://api.example.test/#login",
    "https://user:secret@api.example.test",
  ]) {
    expect(() =>
      readApiPublicOrigin({ API_PUBLIC_ORIGIN: configured }),
    ).toThrow(
      "API_PUBLIC_ORIGIN must be a bare origin, with no path, query, fragment or credentials",
    );
  }
});

test("outside production each request's own origin stands in", () => {
  expect(readApiPublicOrigin({})).toBeNull();
});

test("the Host-header fallback is reported at startup", () => {
  expect(apiPublicOriginFallbackWarning({})).toContain(
    "API_PUBLIC_ORIGIN is unset",
  );
  expect(
    apiPublicOriginFallbackWarning({
      API_PUBLIC_ORIGIN: "https://api.example.test",
    }),
  ).toBeNull();
  expect(apiPublicOriginFallbackWarning({ NODE_ENV: "test" })).toBeNull();
});
