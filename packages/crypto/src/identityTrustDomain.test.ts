import { expect, test } from "bun:test";
import { canonicalIdentityTrustDomain } from "./identityTrustDomain";
import { KeyingVerificationError } from "./keying/verificationError";

test.each([
  ["HTTPS://API.Example.Test:443/v1/../api///", "https://api.example.test/api"],
  ["http://localhost:80/", "http://localhost"],
  ["http://localhost:3001/api/", "http://localhost:3001/api"],
  ["https://api.example.test//api///", "https://api.example.test//api"],
  ["https://api.example.test/a%2Fb/", "https://api.example.test/a%2Fb"],
  ["https://[::1]:443/api/", "https://[::1]/api"],
])("identity domains canonicalize %s to %s", (input, expected) => {
  expect(canonicalIdentityTrustDomain(input)).toBe(expected);
});

test("relative identity domains retain the explicitly supplied host's base path", () => {
  expect(
    canonicalIdentityTrustDomain("../api///", "https://app.example.test/view/"),
  ).toBe("https://app.example.test/api");
});

test.each([
  "api.example.test",
  "file:///api",
  "wss://api.example.test",
  "https://user:password@api.example.test",
  "https://api.example.test/api?tenant=one",
  "https://api.example.test/api#identity",
])("identity domains reject ambiguous input %s", (input) => {
  expect(() => canonicalIdentityTrustDomain(input)).toThrow(
    KeyingVerificationError,
  );
});
