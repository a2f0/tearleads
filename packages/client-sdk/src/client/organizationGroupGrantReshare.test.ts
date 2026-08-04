import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ExecSql } from "../data/sqlite/sqlSchema";
import type { ContainerContents } from "./containerContents";
import { reshareGroupContainerGrantsAfterRotation } from "./organizationGroupGrantReshare";
import {
  CURRENT_USER_ID,
  EXPECTED_HEAD,
  fakeContainerContents,
  GRANTED_GROUP_ID,
  ORGANIZATION_ID,
  type RewrapCall,
  seedReadModel,
} from "./organizationGroupGrantReshare.testFixtures";

async function run(input: {
  contents: ContainerContents;
  execSql: ExecSql;
  reconcileReadModel?: () => Promise<unknown>;
}): Promise<void> {
  await reshareGroupContainerGrantsAfterRotation({
    containerContents: input.contents,
    currentUserId: CURRENT_USER_ID,
    execSql: input.execSql,
    expectedGroupHead: EXPECTED_HEAD,
    log: () => undefined,
    mutatedGroupId: GRANTED_GROUP_ID,
    organizationId: ORGANIZATION_ID,
    reconcileReadModel: input.reconcileReadModel ?? (async () => ({})),
  });
}

test("re-wraps every container the rotated group is directly granted", async () => {
  const { close, execSql } = await createTestExecSql("group-grant-reshare-all");
  try {
    await seedReadModel(execSql);
    const prepareCalls: RewrapCall[] = [];
    const rewrapped: string[] = [];
    await run({
      contents: fakeContainerContents({ prepareCalls, rewrapped }),
      execSql,
    });

    expect(rewrapped.toSorted()).toEqual(["container-a", "container-b"]);
    // A grant naming a different group is never touched by this group's sweep.
    expect(
      prepareCalls.some((call) => call.containerId === "container-other"),
    ).toBe(false);
    // Never mint a grant: the signed manifest, not the server-fed read model,
    // decides whether the group already holds one.
    expect(prepareCalls.every((call) => call.requireExistingGrant)).toBe(true);
    expect(
      prepareCalls.every((call) => call.groupId === GRANTED_GROUP_ID),
    ).toBe(true);
  } finally {
    close();
  }
});

test("skips a container already carrying the committed head", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-current",
  );
  try {
    await seedReadModel(execSql);
    const prepareCalls: RewrapCall[] = [];
    const rewrapped: string[] = [];
    await run({
      contents: fakeContainerContents({
        currentContainerIds: new Set(["container-a"]),
        prepareCalls,
        rewrapped,
      }),
      execSql,
    });

    // container-a stands in for the root container the root coordinator
    // already repaired on this same mutation: prepared, but not re-shared.
    expect(rewrapped).toEqual(["container-b"]);
  } finally {
    close();
  }
});

test("a container whose manifest withholds the grant is left alone", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-not-granted",
  );
  try {
    await seedReadModel(execSql);
    const prepareCalls: RewrapCall[] = [];
    const rewrapped: string[] = [];
    await run({
      contents: fakeContainerContents({
        notGrantedContainerIds: new Set(["container-a"]),
        prepareCalls,
        rewrapped,
      }),
      execSql,
    });

    expect(rewrapped).toEqual(["container-b"]);
  } finally {
    close();
  }
});

test("an unreachable container does not abort the rest of the sweep", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-failure",
  );
  try {
    await seedReadModel(execSql);
    const prepareCalls: RewrapCall[] = [];
    const rewrapped: string[] = [];
    const logged: string[] = [];
    await reshareGroupContainerGrantsAfterRotation({
      containerContents: fakeContainerContents({
        prepareCalls,
        rewrapped,
        throwForContainerIds: new Set(["container-a"]),
      }),
      currentUserId: CURRENT_USER_ID,
      execSql,
      expectedGroupHead: EXPECTED_HEAD,
      log: (message) => logged.push(message),
      mutatedGroupId: GRANTED_GROUP_ID,
      organizationId: ORGANIZATION_ID,
      reconcileReadModel: async () => ({}),
    });

    expect(rewrapped).toEqual(["container-b"]);
    expect(logged.some((message) => message.includes("container-a"))).toBe(
      true,
    );
  } finally {
    close();
  }
});

test("pulls the read model before it enumerates any grant", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-reconcile",
  );
  try {
    await seedReadModel(execSql);
    const prepareCalls: RewrapCall[] = [];
    const rewrapped: string[] = [];
    const order: string[] = [];
    await run({
      contents: fakeContainerContents({ order, prepareCalls, rewrapped }),
      execSql,
      reconcileReadModel: async () => {
        order.push("reconcile");
        return {};
      },
    });

    // Enumeration reads the local cache, so any container visited before the
    // pull resolves was chosen from a stale grant set — the failure mode this
    // ordering exists to prevent. Asserting the pull is strictly first is what
    // rules that out; a grant absent at seed time is never enumerated at all.
    expect(order[0]).toBe("reconcile");
    expect(order.filter((entry) => entry.startsWith("prepare:"))).toEqual([
      "prepare:container-a",
      "prepare:container-b",
    ]);
  } finally {
    close();
  }
});

test("still sweeps when the pull fails but the rotation is visible", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-reconcile-failure",
  );
  try {
    await seedReadModel(execSql);
    const prepareCalls: RewrapCall[] = [];
    const rewrapped: string[] = [];
    const logged: string[] = [];
    const outcome = await reshareGroupContainerGrantsAfterRotation({
      containerContents: fakeContainerContents({ prepareCalls, rewrapped }),
      currentUserId: CURRENT_USER_ID,
      execSql,
      expectedGroupHead: EXPECTED_HEAD,
      log: (message) => logged.push(message),
      mutatedGroupId: GRANTED_GROUP_ID,
      organizationId: ORGANIZATION_ID,
      reconcileReadModel: async () => {
        throw new Error("offline");
      },
    });

    // A failed pull is not itself disqualifying: what gates the sweep is
    // whether the rotation is visible, and here the local head already is it.
    expect(outcome.headConfirmed).toBe(true);
    expect(rewrapped.toSorted()).toEqual(["container-a", "container-b"]);
    expect(logged.some((message) => message.includes("offline"))).toBe(true);
  } finally {
    close();
  }
});

test("does not sweep when the rotation never appears", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-uncommitted",
  );
  try {
    await seedReadModel(execSql);
    const prepareCalls: RewrapCall[] = [];
    const rewrapped: string[] = [];
    const outcome = await reshareGroupContainerGrantsAfterRotation({
      containerContents: fakeContainerContents({ prepareCalls, rewrapped }),
      currentUserId: CURRENT_USER_ID,
      execSql,
      // A head the read model does not carry: the mutation never committed.
      expectedGroupHead: { ...EXPECTED_HEAD, stateHash: "never-committed" },
      log: () => undefined,
      mutatedGroupId: GRANTED_GROUP_ID,
      organizationId: ORGANIZATION_ID,
      reconcileReadModel: async () => ({}),
    });

    // The head is captured before the policy write and the sweep also runs on
    // the throwing path, so an uncommitted mutation must not re-share anything.
    expect(outcome.headConfirmed).toBe(false);
    expect(prepareCalls).toEqual([]);
    expect(rewrapped).toEqual([]);
  } finally {
    close();
  }
});

test("logs a container whose preparation is unavailable", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-unavailable",
  );
  try {
    await seedReadModel(execSql);
    const logged: string[] = [];
    await reshareGroupContainerGrantsAfterRotation({
      containerContents: {
        openTree: () => ({ prepareGroupRewrap: async () => null }),
      } as unknown as ContainerContents,
      currentUserId: CURRENT_USER_ID,
      execSql,
      expectedGroupHead: EXPECTED_HEAD,
      log: (message) => logged.push(message),
      mutatedGroupId: GRANTED_GROUP_ID,
      organizationId: ORGANIZATION_ID,
      reconcileReadModel: async () => ({}),
    });

    // Unavailable is not "not-granted": the grant is neither confirmed nor
    // refuted, so staying silent would read as a clean sweep.
    expect(logged.filter((m) => m.includes("unavailable")).length).toBe(2);
  } finally {
    close();
  }
});

test("a forbidden container does not strand the ones after it", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-partial-authorization",
  );
  try {
    await seedReadModel(execSql);
    const rewrapped: string[] = [];
    const logged: string[] = [];
    const outcome = await reshareGroupContainerGrantsAfterRotation({
      containerContents: fakeContainerContents({
        forbiddenContainerIds: new Set(["container-a"]),
        prepareCalls: [],
        rewrapped,
      }),
      currentUserId: CURRENT_USER_ID,
      execSql,
      expectedGroupHead: EXPECTED_HEAD,
      log: (message) => logged.push(message),
      mutatedGroupId: GRANTED_GROUP_ID,
      organizationId: ORGANIZATION_ID,
      reconcileReadModel: async () => ({}),
    });

    // Aborting on the first 403 would strand container-b, which this same
    // signer is perfectly able to repair.
    expect(rewrapped).toEqual(["container-b"]);
    expect(outcome.unresolvedContainerIds).toEqual(["container-a"]);
    expect(outcome.onlyUnauthorizedRemains).toBe(true);
    expect(logged.some((m) => m.includes("not permitted"))).toBe(true);
  } finally {
    close();
  }
});
