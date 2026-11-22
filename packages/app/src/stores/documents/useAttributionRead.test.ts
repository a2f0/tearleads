import { expect, test } from "bun:test";
import { shouldFetchAttribution } from "./useAttributionRead";

test("shouldFetchAttribution requires enabled, a synced doc, auth, and online", () => {
  const base = {
    documentId: "doc-1",
    enabled: true,
    isAuthenticated: true,
    online: true,
  };
  expect(shouldFetchAttribution(base)).toBe(true);
  expect(shouldFetchAttribution({ ...base, enabled: false })).toBe(false);
  expect(shouldFetchAttribution({ ...base, documentId: null })).toBe(false);
  expect(shouldFetchAttribution({ ...base, isAuthenticated: false })).toBe(
    false,
  );
  expect(shouldFetchAttribution({ ...base, online: false })).toBe(false);
});
