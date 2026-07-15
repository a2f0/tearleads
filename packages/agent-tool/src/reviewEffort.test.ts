import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CLAUDE_EFFORT,
  DEFAULT_CODEX_EFFORT,
  REVIEW_EFFORT_LEVELS,
  resolveReviewEffort,
} from "./reviewEffort";
import { buildClaudeReviewArgs } from "./solicitClaudeCodeReview";
import { buildCodexReviewArgs } from "./solicitCodexReview";

describe("review effort defaults", () => {
  test("claude defaults to xhigh, codex to high", () => {
    expect(DEFAULT_CLAUDE_EFFORT).toBe("xhigh");
    expect(DEFAULT_CODEX_EFFORT).toBe("high");
  });
});

describe("resolveReviewEffort", () => {
  test("falls back to the agent default when no effort is given", () => {
    expect(resolveReviewEffort(undefined, DEFAULT_CLAUDE_EFFORT)).toBe("xhigh");
    expect(resolveReviewEffort(undefined, DEFAULT_CODEX_EFFORT)).toBe("high");
    expect(resolveReviewEffort("   ", DEFAULT_CODEX_EFFORT)).toBe("high");
  });

  test("uses an explicit level, trimmed", () => {
    expect(resolveReviewEffort("  max  ", DEFAULT_CODEX_EFFORT)).toBe("max");
    expect(resolveReviewEffort("low", DEFAULT_CLAUDE_EFFORT)).toBe("low");
  });

  test("accepts every documented level", () => {
    for (const level of REVIEW_EFFORT_LEVELS) {
      expect(resolveReviewEffort(level, DEFAULT_CODEX_EFFORT)).toBe(level);
    }
  });

  test("throws on an unknown level rather than passing it to the CLI", () => {
    expect(() => resolveReviewEffort("turbo", DEFAULT_CODEX_EFFORT)).toThrow(
      /Unknown review effort 'turbo'/,
    );
    expect(() => resolveReviewEffort("XHIGH", DEFAULT_CODEX_EFFORT)).toThrow(
      /Unknown review effort/,
    );
  });
});

describe("buildClaudeReviewArgs", () => {
  test("passes --effort and keeps --print", () => {
    expect(buildClaudeReviewArgs("xhigh")).toEqual([
      "--effort",
      "xhigh",
      "--print",
    ]);
  });
});

describe("buildCodexReviewArgs", () => {
  const context = {
    baseRef: "origin/main",
    prNumber: "1540",
    branch: "feat/x",
  };

  test("pins the effort via a TOML-quoted config override", () => {
    const args = buildCodexReviewArgs(context, "high");
    const flagIndex = args.indexOf("-c");
    expect(flagIndex).toBeGreaterThan(-1);
    expect(args[flagIndex + 1]).toBe('model_reasoning_effort="high"');
  });

  test("keeps the base ref and title", () => {
    expect(buildCodexReviewArgs(context, "high")).toEqual([
      "review",
      "-c",
      'model_reasoning_effort="high"',
      "--base",
      "origin/main",
      "--title",
      "PR #1540 (feat/x)",
    ]);
  });
});
