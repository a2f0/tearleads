import { describe, expect, test } from "bun:test";

import {
  buildSquashMergeArgs,
  parsePullRequestMergeTarget,
} from "./squashMerge";

const target = { headOid: "def456", id: "PR_node_id" };

describe("buildSquashMergeArgs", () => {
  test("builds a subject-only squash with an empty body", () => {
    const args = buildSquashMergeArgs(target, "feat(app): add widget (#1537)");
    expect(args.slice(0, 3)).toEqual(["api", "graphql", "-f"]);
    expect(args).toContain("pullRequestId=PR_node_id");
    expect(args).toContain("commitHeadline=feat(app): add widget (#1537)");
    expect(args).toContain("commitBody=");
    expect(args).toContain("expectedHeadOid=def456");
    expect(args).toContain("mergeMethod=SQUASH");
  });

  test("binds the mutation to an explicitly reviewed head SHA", () => {
    const args = buildSquashMergeArgs(target, "feat: x (#1537)", "abc123");
    expect(args).toContain("expectedHeadOid=abc123");
  });

  test("uses the current head SHA when no reviewed SHA is provided", () => {
    const args = buildSquashMergeArgs(target, "feat: x (#1537)", "");
    expect(args).toContain("expectedHeadOid=def456");
  });
});

describe("parsePullRequestMergeTarget", () => {
  const response = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            autoMergeRequest: null,
            headRefOid: "abc123",
            id: "PR_node_id",
            isInMergeQueue: false,
            state: "OPEN",
            ...overrides,
          },
        },
      },
    });

  test("accepts an open synchronous merge target", () => {
    expect(parsePullRequestMergeTarget(response())).toEqual({
      headOid: "abc123",
      id: "PR_node_id",
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
});
