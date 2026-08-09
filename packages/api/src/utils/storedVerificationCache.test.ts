import { expect, test } from "bun:test";
import { StoredVerificationCache } from "./storedVerificationCache";

test("stored verification cache rejects in-place source edits", () => {
  const cache = new StoredVerificationCache<object>(2);
  const verified = { state: "verified" };

  cache.set("manifest-hash", { grants: ["owner"] }, verified);

  expect(cache.get("manifest-hash", { grants: ["owner"] })).toBe(verified);
  expect(
    cache.get("manifest-hash", { grants: ["owner", "outsider"] }),
  ).toBeUndefined();
});

test("stored verification cache evicts the least recently used entry", () => {
  const cache = new StoredVerificationCache<string>(2);
  cache.set("first", { version: 1 }, "first-value");
  cache.set("second", { version: 1 }, "second-value");
  expect(cache.get("first", { version: 1 })).toBe("first-value");

  cache.set("third", { version: 1 }, "third-value");

  expect(cache.get("second", { version: 1 })).toBeUndefined();
  expect(cache.get("first", { version: 1 })).toBe("first-value");
  expect(cache.get("third", { version: 1 })).toBe("third-value");
});
