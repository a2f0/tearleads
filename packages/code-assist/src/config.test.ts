import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config";

function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void,
): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      const value = saved[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("loadConfig ignorePatterns", () => {
  test("uses defaults when unset", () => {
    withEnv(
      { DEEPSEEK_API_KEY: "x", CODE_ASSIST_IGNORE_PATTERNS: undefined },
      () => {
        expect(loadConfig().ignorePatterns.length).toBeGreaterThan(0);
      },
    );
  });

  test("an explicit empty value disables filtering", () => {
    withEnv({ DEEPSEEK_API_KEY: "x", CODE_ASSIST_IGNORE_PATTERNS: "" }, () => {
      expect(loadConfig().ignorePatterns).toEqual([]);
    });
  });

  test("parses and trims a comma-separated override", () => {
    withEnv(
      { DEEPSEEK_API_KEY: "x", CODE_ASSIST_IGNORE_PATTERNS: "a/**, b/** ,, c" },
      () => {
        expect(loadConfig().ignorePatterns).toEqual(["a/**", "b/**", "c"]);
      },
    );
  });
});
