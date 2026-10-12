import { expect, test } from "bun:test";
import { readBillingReturnOrigins } from "./returnOrigins";

test("billing requires an explicit allowlist in production", () => {
  for (const NODE_ENV of ["production", "production "]) {
    expect(() => readBillingReturnOrigins({ NODE_ENV })).toThrow(
      "API_BILLING_RETURN_ORIGINS is required",
    );
  }
  expect(readBillingReturnOrigins({})).toEqual([]);
});

test("normalizes approved web and native billing origins", () => {
  expect(
    readBillingReturnOrigins({
      API_BILLING_RETURN_ORIGINS:
        " https://App.Example/, https://localhost,http://127.0.0.1:3002 ",
      NODE_ENV: "production",
    }),
  ).toEqual([
    "https://app.example",
    "https://localhost",
    "http://127.0.0.1:3002",
  ]);
});

test("billing never accepts wildcards or non-origin entries", () => {
  for (const origin of [
    "*",
    "https://app.example,*",
    ",",
    "https://app.example,",
    "https://*.example",
    "ftp://app.example",
    "https://app.example/billing",
    "https://user:password@app.example",
    "https://app.example?next=evil",
    "https://app.example#billing",
  ]) {
    expect(() =>
      readBillingReturnOrigins({
        API_BILLING_RETURN_ORIGINS: origin,
      }),
    ).toThrow("API_BILLING_RETURN_ORIGINS must contain http(s) origins");
  }
});
