import { describe, expect, test } from "bun:test";

import { buildCodexReviewArgs } from "./solicitCodexReview";

describe("buildCodexReviewArgs", () => {
  test("execs ephemerally with pinned permissions and output", () => {
    const args = buildCodexReviewArgs(
      "high",
      "/tmp/x/review-1.md",
      "/repo/root",
    );

    expect(args).toEqual([
      "exec",
      "--ignore-user-config",
      "--ignore-rules",
      "--strict-config",
      "--ephemeral",
      "--disable",
      "plugins",
      "--disable",
      "hooks",
      "--disable",
      "apps",
      "--skip-git-repo-check",
      "-c",
      'model_reasoning_effort="high"',
      "-c",
      'default_permissions="review-snapshot"',
      "-c",
      'permissions.review-snapshot.filesystem={":root"="deny",":minimal"="read","/repo/root"="read"}',
      "-c",
      "permissions.review-snapshot.network.enabled=false",
      "-c",
      'shell_environment_policy.inherit="none"',
      "--color",
      "never",
      "--output-last-message",
      "/tmp/x/review-1.md",
      "-",
    ]);
  });

  test("withholds MCP tools: the sandbox does not confine them", () => {
    // Legacy sandbox modes restrict shell commands only; user-configured MCP
    // servers would still load and could mutate external state on behalf of an
    // attacker-influenceable diff. `-c mcp_servers={}` cannot remove them —
    // table overrides merge — so the user config is ignored wholesale, and
    // plugins, hooks, and app connectors (all merged from outside config.toml)
    // are disabled by feature flag.
    const args = buildCodexReviewArgs(
      "high",
      "/tmp/x/review-1.md",
      "/repo/root",
    );

    expect(args).toContain("--ignore-user-config");
    const disabled = args.filter(
      (_, i) => i > 0 && args[i - 1] === "--disable",
    );
    expect(disabled).toEqual(["plugins", "hooks", "apps"]);
  });

  test("exposes only the snapshot and minimal runtime paths", () => {
    const args = buildCodexReviewArgs(
      "high",
      "/tmp/x/review-1.md",
      "/repo/root",
    );

    expect(args).toContain("--skip-git-repo-check");
    expect(args).not.toContain("--sandbox");
    expect(args).not.toContain("--add-dir");
    expect(args).toContain(
      'permissions.review-snapshot.filesystem={":root"="deny",":minimal"="read","/repo/root"="read"}',
    );
    expect(args).toContain('shell_environment_policy.inherit="none"');
  });

  test("reads the prompt from stdin, never argv", () => {
    const args = buildCodexReviewArgs(
      "xhigh",
      "/tmp/x/review-1.md",
      "/repo/root",
    );

    // `-` must be the trailing positional: it is what makes codex read the
    // prompt (and its potentially argv-breaking diff) from stdin.
    expect(args.at(-1)).toBe("-");
    expect(args).toContain('model_reasoning_effort="xhigh"');
  });
});
