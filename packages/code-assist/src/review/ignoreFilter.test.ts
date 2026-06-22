import { describe, expect, test } from "bun:test";
import { DEFAULT_IGNORE_PATTERNS, isIgnoredPath } from "./ignoreFilter";

describe("isIgnoredPath", () => {
  test("ignores lockfiles and build output by default", () => {
    expect(isIgnoredPath("bun.lock", DEFAULT_IGNORE_PATTERNS)).toBe(true);
    expect(
      isIgnoredPath("packages/api/dist/index.js", DEFAULT_IGNORE_PATTERNS),
    ).toBe(true);
    expect(
      isIgnoredPath("packages/x/.turbo/cache/a", DEFAULT_IGNORE_PATTERNS),
    ).toBe(true);
    expect(isIgnoredPath("tsconfig.tsbuildinfo", DEFAULT_IGNORE_PATTERNS)).toBe(
      true,
    );
  });

  test("reviews normal source files", () => {
    expect(
      isIgnoredPath(
        "packages/code-assist/src/index.ts",
        DEFAULT_IGNORE_PATTERNS,
      ),
    ).toBe(false);
    expect(isIgnoredPath("README.md", DEFAULT_IGNORE_PATTERNS)).toBe(false);
  });

  test("honors custom patterns", () => {
    expect(isIgnoredPath("docs/generated.md", ["docs/**"])).toBe(true);
    expect(isIgnoredPath("src/a.ts", ["docs/**"])).toBe(false);
  });

  test("matches nothing when no patterns are given", () => {
    expect(isIgnoredPath("bun.lock", [])).toBe(false);
  });
});
