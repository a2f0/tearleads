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
      "--safe-mode",
      "--no-chrome",
      "--no-session-persistence",
      "--tools",
      "Read,Grep,Glob",
    ]);
  });

  test("grants the read-only tools a finding may depend on", () => {
    const tools = buildClaudeReviewArgs("high").at(-1) ?? "";

    expect(tools.split(",")).toEqual(["Read", "Grep", "Glob"]);
  });

  test("withholds Bash: a review needs no shell, and the diff is untrusted", () => {
    expect(buildClaudeReviewArgs("high").at(-1)).not.toContain("Bash");
  });

  test("disables ambient customization and external integrations", () => {
    const args = buildClaudeReviewArgs("high");

    expect(args).toContain("--safe-mode");
    expect(args).toContain("--no-chrome");
    expect(args).toContain("--no-session-persistence");
  });
});

describe("buildCodexReviewArgs", () => {
  test("pins the effort via a TOML-quoted config override", () => {
    const args = buildCodexReviewArgs(
      "high",
      "/tmp/x/review-1.md",
      "/repo/root",
    );
    const overrides = args.filter((_, i) => i > 0 && args[i - 1] === "-c");
    expect(overrides).toContain('model_reasoning_effort="high"');
  });
});
