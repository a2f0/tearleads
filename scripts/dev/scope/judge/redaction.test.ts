import { test } from "bun:test";
import assert from "node:assert/strict";
import { toolRecords } from "./claude-evidence";
import { evidenceJson } from "./redaction";

test("captured evidence redacts token fields and provider tokens while retaining failures", () => {
  const token = `sk-ant-oat01-${"a".repeat(32)}`;
  const value = {
    accessToken: "opaque-access-value",
    nested: [
      { output: `CLAUDE_CODE_OAUTH_TOKEN=${token}\ncommand failed: exit 2` },
    ],
    credentialsFile: '{"refresh_token":"opaque-refresh-value"}',
    header: "Authorization: Bearer opaque-bearer-value",
    response: `token copied without a field: ${token}`,
  };
  const serialized = evidenceJson(value);
  for (const secret of [
    token,
    "opaque-access-value",
    "opaque-refresh-value",
    "opaque-bearer-value",
  ])
    assert.ok(!serialized.includes(secret));
  assert.match(serialized, /command failed: exit 2/);
  const session = "0aff1519-a6e0-4d45-b6fe-c2ec86c461fe";
  const records = toolRecords(
    [
      {
        sessionId: session,
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "env", content: value },
          ],
        },
      },
    ],
    session,
  );
  assert.ok(!JSON.stringify(records).includes(token));
  assert.ok(!JSON.stringify(records).includes("opaque-refresh-value"));
});
