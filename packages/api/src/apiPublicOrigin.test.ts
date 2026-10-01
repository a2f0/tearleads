import { expect, test } from "bun:test";
import { readApiPublicOrigin } from "./apiPublicOrigin";

test("a configured public origin is canonicalized", () => {
  expect(
    readApiPublicOrigin({ API_PUBLIC_ORIGIN: " https://api.example.test/ " }),
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

test("outside production each request's own origin stands in", () => {
  expect(readApiPublicOrigin({})).toBeNull();
});
