import { expect, test } from "bun:test";
import { browserRequestAllowed } from "./browser-policy";

test("native browser boundary admits CLI and the exact local portal only", () => {
  const host = "127.0.0.1:3101";
  for (const origin of [
    undefined,
    "http://127.0.0.1:3101",
    "http://127.0.0.1:5100",
  ])
    expect(browserRequestAllowed({ host, origin }, 3101, 5100)).toBe(true);
  for (const origin of [
    "null",
    "",
    "https://evil.invalid",
    "http://127.0.0.1:5101",
  ])
    expect(browserRequestAllowed({ host, origin }, 3101, 5100)).toBe(false);
  for (const rebound of [
    undefined,
    "evil.invalid:3101",
    "localhost:3101",
    "127.0.0.1:3102",
  ])
    expect(browserRequestAllowed({ host: rebound }, 3101, 5100)).toBe(false);
  expect(browserRequestAllowed({ host, site: "cross-site" }, 3101, 5100)).toBe(
    false,
  );
});
