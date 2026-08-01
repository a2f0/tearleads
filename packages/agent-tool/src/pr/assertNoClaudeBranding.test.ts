import { describe, expect, test } from "bun:test";

import { assertNoClaudeBranding } from "./assertNoClaudeBranding";

describe("assertNoClaudeBranding", () => {
  test("accepts an empty body", () => {
    expect(() => assertNoClaudeBranding("")).not.toThrow();
  });

  test("accepts a normal summary body", () => {
    expect(() =>
      assertNoClaudeBranding("## Summary\nAdds a widget and a test."),
    ).not.toThrow();
  });

  test("allows prose that mentions the tooling without the branding footer", () => {
    expect(() =>
      assertNoClaudeBranding(
        "Updates the cross-agent-review skill so Claude Code reviews the diff.",
      ),
    ).not.toThrow();
  });

  test("rejects the canonical generated-with footer", () => {
    const body =
      "## Summary\nx\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)";
    expect(() => assertNoClaudeBranding(body)).toThrow(/Claude Code branding/);
  });

  test("rejects the claude.ai/code link variant", () => {
    expect(() =>
      assertNoClaudeBranding("See https://claude.ai/code for details"),
    ).toThrow(/claude\.com\/claude-code or claude\.ai\/code/);
  });

  test("rejects a Co-authored-by Claude trailer", () => {
    expect(() =>
      assertNoClaudeBranding("Co-Authored-By: Claude <noreply@anthropic.com>"),
    ).toThrow(/Co-authored-by Claude trailer/);
  });

  test("is case-insensitive on the attribution text", () => {
    expect(() => assertNoClaudeBranding("generated with claude code")).toThrow(
      /Claude Code branding/,
    );
  });
});
