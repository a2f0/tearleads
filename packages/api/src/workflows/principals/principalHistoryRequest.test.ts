import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { loadOrganizationHistoryWindow } from "../../access/read/principalHistory";
import { listPrincipalStateHistory } from "../../access/read/principalStateStore";
import { withPrincipalHistoryRequest } from "../../utils/principalHistoryWork";
import { loadVerifiedPrincipalPolicySnapshotsForReferences } from "./principalPolicySnapshots";

const reference = {
  principalType: "group" as const,
  principalId: crypto.randomUUID(),
  version: 1,
  stateHash: "a".repeat(64),
  keyFingerprint: "b".repeat(64),
  keyEpoch: 1,
};
const loaders = [
  (executor: typeof db) =>
    loadOrganizationHistoryWindow(executor, reference.principalId, 2),
  (executor: typeof db) =>
    loadVerifiedPrincipalPolicySnapshotsForReferences(executor, [reference]),
  (executor: typeof db) => listPrincipalStateHistory(reference, executor),
];

for (const [index, load] of loaders.entries()) {
  test(`history loader ${index} opts out before its first database read`, async () => {
    const events: string[] = [];
    const stop = new Error("Reached history load");
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
        () => load(executor),
      ),
    ).rejects.toBe(stop);
    expect(events).toEqual(["begin", "read"]);
  });
}
