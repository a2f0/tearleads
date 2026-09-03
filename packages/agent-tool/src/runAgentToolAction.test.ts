import { describe, expect, test } from "bun:test";

import {
  type AgentToolActions,
  runAgentToolAction,
} from "./runAgentToolAction";

function actionsWith(overrides: Partial<AgentToolActions>): AgentToolActions {
  return {
    openPr: () => 0,
    solicitClaudeCodeReview: () => 0,
    solicitCodexReview: () => 0,
    squashMerge: () => 0,
    ...overrides,
  };
}

describe("runAgentToolAction", () => {
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
    });

    runAgentToolAction("/repo", ["openPr"], actions);
    runAgentToolAction("/repo", ["solicitClaudeCodeReview"], actions);
    runAgentToolAction("/repo", ["solicitCodexReview"], actions);

    expect(calls).toEqual([
      "openPr",
      "solicitClaudeCodeReview",
      "solicitCodexReview",
    ]);
  });
});
