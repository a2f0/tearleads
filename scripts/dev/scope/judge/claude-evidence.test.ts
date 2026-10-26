import { test } from "bun:test";
import assert from "node:assert/strict";
import { toolRecords, transcriptIdentity } from "./claude-evidence";

const session = "e4bf2c38-2720-4d90-9f4a-fe9bb300c105";
const events = [
  {
    source: "coder-acp-claude-code",
    message: "Fresh workspace created",
    data: { workspacePath: "/tmp/workspaces/project-db6a2b67" },
  },
  {
    source: "coder-acp-claude-code",
    message: `Created session: ${session}`,
    data: { iteration: 1 },
  },
];
test("native evidence uses the exact run session and rejects unrelated paths", () => {
  assert.deepEqual(transcriptIdentity(events, 1), {
    workspace: "/tmp/workspaces/project-db6a2b67",
    session,
  });
  assert.equal(transcriptIdentity(events, 2), undefined);
  assert.equal(
    transcriptIdentity(
      [
        ...events,
        {
          source: "coder-acp-claude-code",
          message: "Fresh workspace created",
          data: { workspacePath: "/Users/someone/project" },
        },
      ],
      1,
    ),
    undefined,
  );
  assert.equal(
    transcriptIdentity(
      [
        ...events,
        {
          source: "coder-acp-claude-code",
          message: "Created session: ../../auth",
          data: { iteration: 1 },
        },
      ],
      1,
    ),
    undefined,
  );
});

test("tool capture retains full failures but strips reasoning and unrelated sessions", () => {
  const failure = {
    type: "tool_result",
    tool_use_id: "call",
    content: "mise error; zsh: no matches found",
    is_error: true,
  };
  const records = toolRecords(
    [
      {
        sessionId: session,
        type: "assistant",
        message: {
          model: "test-model",
          content: [
            {
              type: "thinking",
              thinking: "private reasoning",
              signature: "private",
            },
            {
              type: "tool_use",
              id: "call",
              name: "Bash",
              input: { command: "read files" },
            },
          ],
        },
      },
      { sessionId: session, type: "user", message: { content: [failure] } },
      { sessionId: "other", type: "user", message: { content: [failure] } },
    ],
    session,
  );
  assert.equal(records.length, 2);
  assert.equal(records[0]?.content.length, 1);
  assert.deepEqual(records[1]?.content, [failure]);
  assert.doesNotMatch(JSON.stringify(records), /private/);
});
