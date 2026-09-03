import { expect, test } from "bun:test";
import { runGroupShareScenario } from "./shareGroupScenario.testFixtures";

// A share chosen by name must carry that name; only the grant-preserving
// re-wrap may omit it. The facade enforces this for every caller.
test("a group share that could mint a grant must carry the chosen name", async () => {
  let shareCalls = 0;

  await expect(
    runGroupShareScenario({
      currentGroupKeyEpoch: 2,
      expectedGroupName: null,
      onShareCall: () => {
        shareCalls += 1;
      },
      pinnedKeyEpoch: 1,
      remoteAccessStateHash: "remote-access-state-hash-nameless",
      testLabel: "containerContents-share-group-nameless",
    }),
  ).rejects.toThrow("Container group share requires the chosen group name");
  expect(shareCalls).toBe(0);
});

// A duplicate share mints nothing, but it must not report success for a group
// the user did not choose: the chosen name is bound to the signed group policy
// before the short-circuit. These scenarios give the runtime a writer context,
// so the binding runs instead of the flow stopping at the unavailable context.

test("a duplicate group share rejects a name the signed policy does not commit", async () => {
  let shareCalls = 0;

  await expect(
    runGroupShareScenario({
      currentGroupKeyEpoch: 2,
      expectedGroupName: "Operators",
      onShareCall: () => {
        shareCalls += 1;
      },
      pinnedKeyEpoch: 2,
      remoteAccessStateHash: "remote-access-state-hash-duplicate-mismatch",
      testLabel: "containerContents-share-group-duplicate-name-mismatch",
      writerContext: true,
    }),
  ).rejects.toMatchObject({
    code: "object_mismatch",
    message: expect.stringContaining(
      "Container share group name does not match the signed group policy",
    ),
  });
  expect(shareCalls).toBe(0);
});

test("a duplicate group share with the chosen name still short-circuits", async () => {
  const { containerId, groupId, logs, shareCallCount } =
    await runGroupShareScenario({
      currentGroupKeyEpoch: 2,
      expectedGroupName: "Members",
      pinnedKeyEpoch: 2,
      remoteAccessStateHash: "remote-access-state-hash-duplicate-match",
      testLabel: "containerContents-share-group-duplicate-name-match",
      writerContext: true,
    });

  expect(logs).not.toContain(
    "Container contents: skipped container group share because the writer context is unavailable.",
  );
  expect(logs).toContain(
    `Container contents: skipped duplicate share for container ${containerId} with group ${groupId}`,
  );
  expect(shareCallCount).toBe(0);
});
