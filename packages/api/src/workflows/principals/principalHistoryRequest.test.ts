import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { withPrincipalHistoryRequest } from "../../utils/principalHistoryWork";
import { loadVerifiedPrincipalPolicySnapshotsForReferences } from "./principalPolicySnapshots";

test("snapshot history opts out before its first database read", async () => {
  const events: string[] = [];
  const stop = new Error("Reached snapshot history load");
  const executor = new Proxy(db, {
    get(target, key, receiver) {
      if (key === "select")
        return () => {
          events.push("read");
          throw stop;
        };
      return Reflect.get(target, key, receiver);
    },
  });
  await expect(
    withPrincipalHistoryRequest(
      () => events.push("begin"),
      () =>
        loadVerifiedPrincipalPolicySnapshotsForReferences(executor, [
          {
            principalType: "group",
            principalId: crypto.randomUUID(),
            version: 1,
            stateHash: "a".repeat(64),
            keyFingerprint: "b".repeat(64),
            keyEpoch: 1,
          },
        ]),
    ),
  ).rejects.toBe(stop);
  expect(events).toEqual(["begin", "read"]);
});
