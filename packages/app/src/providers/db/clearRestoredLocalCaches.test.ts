import { expect, test } from "bun:test";
import { clearRestoredLocalCaches } from "./clearRestoredLocalCaches";

// Minimal in-memory Storage stand-in so the test never touches (or depends on)
// the ambient window.localStorage.
function createFakeStorage(
  entries: Readonly<Record<string, string>>,
): Storage & { snapshot: () => Record<string, string> } {
  const map = new Map<string, string>(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key(index: number): string | null {
      return [...map.keys()][index] ?? null;
    },
    getItem(key: string): string | null {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      map.set(key, value);
    },
    removeItem(key: string): void {
      map.delete(key);
    },
    clear(): void {
      map.clear();
    },
    snapshot(): Record<string, string> {
      return Object.fromEntries(map);
    },
  };
}

test("removes the stale pre-restore caches but preserves the identity registry", () => {
  const storage = createFakeStorage({
    "symcrypt.local-session:sqlite:fingerprint": "session",
    "symcrypt.documents.device-seed": "doc-seed",
    "symcrypt.documents:pane.left.session-peer-seed": "doc-tab-seed",
    "symcrypt.container-metadata.device-seed": "meta-seed",
    "symcrypt.app.local-identity-registry": "keep-me",
    "symcrypt.feature-flags:beta": "keep-me-too",
  });

  clearRestoredLocalCaches(storage);

  expect(storage.snapshot()).toEqual({
    "symcrypt.app.local-identity-registry": "keep-me",
    "symcrypt.feature-flags:beta": "keep-me-too",
  });
});

test("is a no-op when there are no stale caches", () => {
  const storage = createFakeStorage({
    "symcrypt.app.local-identity-registry": "keep-me",
  });

  clearRestoredLocalCaches(storage);

  expect(storage.snapshot()).toEqual({
    "symcrypt.app.local-identity-registry": "keep-me",
  });
});

test("does not throw when no storage is available", () => {
  expect(() => clearRestoredLocalCaches(undefined)).not.toThrow();
});
