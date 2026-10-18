import { expect, test } from "bun:test";
import { type ExecSql, runSerializedSqlMutation } from "../sqlite/sqlSchema";
import { getOrCreatePrincipalPolicyCoordinator } from "./principalPolicyCoordinator";

const database = () => (async () => []) as ExecSql;

const scope = (organizationId: string) => ({
  identityTrustDomain: "test",
  organizationId,
  signingFingerprint: "fingerprint",
  userId: "user-1",
});

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("a transaction's locked executor shares its database's coordinator", async () => {
  const execSql = database();
  const coordinator = getOrCreatePrincipalPolicyCoordinator(execSql);
  await runSerializedSqlMutation(execSql, (locked) => {
    expect(locked).not.toBe(execSql);
    expect(getOrCreatePrincipalPolicyCoordinator(locked)).toBe(coordinator);
    // Applied hints are invalidated outside transactions today; one made
    // through a locked executor must still reach recovery on the client's.
    getOrCreatePrincipalPolicyCoordinator(locked).invalidateRecovery("org-1");
  });
  expect(coordinator.recoveryEpoch("org-1")).toBe(1);
  expect(getOrCreatePrincipalPolicyCoordinator(database())).not.toBe(
    coordinator,
  );
});

test("recovery epochs count applied hints per organization", () => {
  const coordinator = getOrCreatePrincipalPolicyCoordinator(database());
  expect(coordinator.recoveryEpoch("org-1")).toBe(0);
  coordinator.invalidateRecovery("org-1");
  coordinator.invalidateRecovery("org-1");
  coordinator.invalidateRecovery("org-2");
  expect(coordinator.recoveryEpoch("org-1")).toBe(2);
  expect(coordinator.recoveryEpoch("org-2")).toBe(1);
});

test("recovery runs one at a time per organization and survives a failure", async () => {
  const coordinator = getOrCreatePrincipalPolicyCoordinator(database());
  const gate = deferred();
  const events: string[] = [];
  const first = coordinator.queueRecovery("org-1", async () => {
    events.push("first:start");
    await gate.promise;
    events.push("first:end");
    throw new Error("first failed");
  });
  const second = coordinator.queueRecovery("org-1", async () => {
    events.push("second");
    return 2;
  });
  const other = coordinator.queueRecovery("org-2", async () => {
    events.push("other");
    return 3;
  });
  expect(await other).toBe(3);
  expect(events).toEqual(["first:start", "other"]);
  gate.resolve();
  await expect(first).rejects.toThrow("first failed");
  expect(await second).toBe(2);
  expect(events).toEqual(["first:start", "other", "first:end", "second"]);
});

test("journal operations run one at a time per mutation scope", async () => {
  const execSql = database();
  const started = deferred();
  const gate = deferred();
  const events: string[] = [];
  const owned = getOrCreatePrincipalPolicyCoordinator(
    execSql,
  ).runJournalOperation(scope("org-1"), async () => {
    events.push("owned:start");
    started.resolve();
    await gate.promise;
    events.push("owned:end");
  });
  await started.promise;
  await runSerializedSqlMutation(execSql, async (locked) => {
    const waiting = getOrCreatePrincipalPolicyCoordinator(
      locked,
    ).runJournalOperation(scope("org-1"), async () => {
      events.push("recover");
    });
    await getOrCreatePrincipalPolicyCoordinator(locked).runJournalOperation(
      scope("org-2"),
      async () => {
        events.push("other scope");
      },
    );
    expect(events).toEqual(["owned:start", "other scope"]);
    gate.resolve();
    await Promise.all([owned, waiting]);
  });
  expect(events).toEqual([
    "owned:start",
    "other scope",
    "owned:end",
    "recover",
  ]);
});
