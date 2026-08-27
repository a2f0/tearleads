import { describe, expect, test } from "bun:test";

import {
  assertAtomicSquashCandidate,
  assertSquashCommitMessage,
  atomicRuleCoverage,
  buildAtomicSquashPushArgs,
  parsePullRequestMergeTarget,
} from "./squashMerge";

const target = {
  baseRefName: "main",
  headOid: "def456",
};

describe("buildAtomicSquashPushArgs", () => {
  test("binds an explicit base ref to its reviewed head and base OID", () => {
    expect(
      buildAtomicSquashPushArgs(
        "https://github.com/owner/repo",
        target,
        "abc123",
      ),
    ).toEqual([
      "push",
      "--force-with-lease=refs/heads/main:abc123",
      "https://github.com/owner/repo",
      "def456:refs/heads/main",
    ]);
  });
});

describe("assertAtomicSquashCandidate", () => {
  test("accepts one reviewed squash commit directly on the base", () => {
    expect(() =>
      assertAtomicSquashCandidate(
        target,
        "def456",
        "main",
        "abc123",
        "def456",
        "def456 abc123",
      ),
    ).not.toThrow();
  });

  test("rejects a moved head, retarget, merge commit, or stale parent", () => {
    expect(() =>
      assertAtomicSquashCandidate(
        target,
        "moved",
        "main",
        "abc123",
        "def456",
        "def456 abc123",
      ),
    ).toThrow("heads must match");
    expect(() =>
      assertAtomicSquashCandidate(
        target,
        "def456",
        "release",
        "abc123",
        "def456",
        "def456 abc123",
      ),
    ).toThrow("base changed");
    expect(() =>
      assertAtomicSquashCandidate(
        target,
        "def456",
        "main",
        "abc123",
        "def456",
        "def456 abc123 parent2",
      ),
    ).toThrow("one non-merge squash commit");
    expect(() =>
      assertAtomicSquashCandidate(
        target,
        "def456",
        "main",
        "abc123",
        "def456",
        "def456 stale",
      ),
    ).toThrow("not based on the validated base");
  });
});

describe("assertSquashCommitMessage", () => {
  test("accepts only the exact subject with an empty body", () => {
    expect(() =>
      assertSquashCommitMessage(
        "fix(app): resolve issue (#42)",
        "",
        "fix(app): resolve issue (#42)",
      ),
    ).not.toThrow();
    expect(() =>
      assertSquashCommitMessage("fix(app): other (#42)", "", "expected"),
    ).toThrow("does not match");
    expect(() =>
      assertSquashCommitMessage("expected", "details", "expected"),
    ).toThrow("must not have a message body");
  });
});

describe("atomicRuleCoverage", () => {
  test("requires active non-bypassable strict checks and squash PRs", () => {
    const protectedRuleset = JSON.stringify({
      current_user_can_bypass: "never",
      enforcement: "active",
      rules: [
        {
          parameters: {
            required_status_checks: [{ context: "ci" }],
            strict_required_status_checks_policy: true,
          },
          type: "required_status_checks",
        },
        {
          parameters: { allowed_merge_methods: ["squash"] },
          type: "pull_request",
        },
      ],
    });
    expect(atomicRuleCoverage([protectedRuleset])).toEqual({
      squashPullRequest: true,
      strictChecks: true,
    });
  });

  test("ignores bypassable, inactive, loose, and empty rules", () => {
    const ineffective = (overrides: Record<string, unknown>) =>
      JSON.stringify({
        current_user_can_bypass: "always",
        enforcement: "disabled",
        rules: [],
        ...overrides,
      });
    expect(
      atomicRuleCoverage([
        ineffective({
          current_user_can_bypass: "never",
          rules: [
            {
              parameters: {
                required_status_checks: [],
                strict_required_status_checks_policy: true,
              },
              type: "required_status_checks",
            },
          ],
        }),
        ineffective({
          enforcement: "active",
          rules: [
            {
              parameters: { allowed_merge_methods: ["squash"] },
              type: "pull_request",
            },
          ],
        }),
      ]),
    ).toEqual({ squashPullRequest: false, strictChecks: false });
  });
});

describe("parsePullRequestMergeTarget", () => {
  const response = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            autoMergeRequest: null,
            baseRefName: "main",
            headRefOid: "abc123",
            isInMergeQueue: false,
            state: "OPEN",
            ...overrides,
          },
        },
      },
    });

  test("accepts an open synchronous merge target", () => {
    expect(parsePullRequestMergeTarget(response())).toEqual({
      baseRefName: "main",
      headOid: "abc123",
    });
  });

  test("rejects a queued merge", () => {
    expect(() =>
      parsePullRequestMergeTarget(response({ isInMergeQueue: true })),
    ).toThrow("queued or automatic merge");
  });

  test("rejects an automatic merge", () => {
    expect(() =>
      parsePullRequestMergeTarget(
        response({ autoMergeRequest: { enabledAt: "2026-08-27T00:00:00Z" } }),
      ),
    ).toThrow("queued or automatic merge");
  });

  test("rejects a PR retargeted after merge validation", () => {
    expect(() => parsePullRequestMergeTarget(response(), "release")).toThrow(
      "base changed from 'release' to 'main'",
    );
  });
});
