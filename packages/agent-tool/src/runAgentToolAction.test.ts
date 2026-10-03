import { describe, expect, test } from "bun:test";

import {
  type AgentToolActions,
  runAgentToolAction,
} from "./runAgentToolAction";

function actionsWith(overrides: Partial<AgentToolActions>): AgentToolActions {
  return {
    prepareVersions: () => 0,
    bumpVersions: () => 0,
    checkVersions: () => 0,
    resolveVersionConflicts: () => 0,
    openPr: () => 0,
    solicitClaudeCodeReview: () => 0,
    solicitCodexReview: () => 0,
    solicitOpencodeReview: () => 0,
    squashMerge: () => 0,
    ...overrides,
  };
}

describe("runAgentToolAction", () => {
  test("dispatches version preparation and rejects extra arguments", () => {
    const calls: unknown[] = [];
    const actions = actionsWith({
      prepareVersions: (root, base) => {
        calls.push([root, base]);
        return 17;
      },
    });
    expect(
      runAgentToolAction("/repo", ["prepareVersions", "abc"], actions),
    ).toBe(17);
    expect(calls).toEqual([["/repo", "abc"]]);
    expect(() =>
      runAgentToolAction("/repo", ["prepareVersions", "abc", "extra"], actions),
    ).toThrow("at most 1");
  });
  test("dispatches the version actions with the pinned base OID", () => {
    const calls: unknown[] = [];
    const actions = actionsWith({
      bumpVersions: (root, base) => {
        calls.push([root, base]);
        return 0;
      },
      checkVersions: (root, base) => {
        calls.push([root, base]);
        return 1;
      },
      resolveVersionConflicts: (root) => {
        calls.push([root]);
        return 0;
      },
    });
    expect(runAgentToolAction("/repo", ["bumpVersions", "abc"], actions)).toBe(
      0,
    );
    expect(runAgentToolAction("/repo", ["checkVersions", "abc"], actions)).toBe(
      1,
    );
    expect(
      runAgentToolAction("/repo", ["resolveVersionConflicts"], actions),
    ).toBe(0);
    expect(calls).toEqual([["/repo", "abc"], ["/repo", "abc"], ["/repo"]]);
    expect(() =>
      runAgentToolAction("/repo", ["bumpVersions", "abc", "extra"], actions),
    ).toThrow("at most 1");
    expect(() =>
      runAgentToolAction(
        "/repo",
        ["resolveVersionConflicts", "extra"],
        actions,
      ),
    ).toThrow("at most 0");
  });
  test("exposes squashMerge with every reviewed-merge positional", () => {
    let received: readonly (string | undefined)[] = [];
    const actions = actionsWith({
      squashMerge: (rootDir, subject, expectedHeadSha, expectedBaseRef) => {
        received = [rootDir, subject, expectedHeadSha, expectedBaseRef];
        return 17;
      },
    });

    expect(
      runAgentToolAction(
        "/repo",
        ["squashMerge", "", "abc123", "main"],
        actions,
      ),
    ).toBe(17);
    expect(received).toEqual(["/repo", "", "abc123", "main"]);
  });

  test("rejects flags or extra positionals that squashMerge cannot consume", () => {
    expect(() =>
      runAgentToolAction(
        "/repo",
        ["squashMerge", "", "abc123", "main", "--keep-branch"],
        actionsWith({}),
      ),
    ).toThrow("squashMerge accepts at most 3 positional arguments");
  });

  test("exposes the other public agent-tool functions", () => {
    const calls: string[] = [];
    const actions = actionsWith({
      openPr: () => {
        calls.push("openPr");
        return 0;
      },
      solicitClaudeCodeReview: () => {
        calls.push("solicitClaudeCodeReview");
        return 0;
      },
      solicitCodexReview: () => {
        calls.push("solicitCodexReview");
        return 0;
      },
      solicitOpencodeReview: () => {
        calls.push("solicitOpencodeReview");
        return 0;
      },
    });

    runAgentToolAction("/repo", ["openPr"], actions);
    runAgentToolAction("/repo", ["solicitClaudeCodeReview"], actions);
    runAgentToolAction("/repo", ["solicitCodexReview"], actions);
    runAgentToolAction("/repo", ["solicitOpencodeReview"], actions);

    expect(calls).toEqual([
      "openPr",
      "solicitClaudeCodeReview",
      "solicitCodexReview",
      "solicitOpencodeReview",
    ]);
  });
});
