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
    shouldContinue: () => true,
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
      shouldContinue: () => true,
    });

    expect(rewrapped).toEqual(["container-b"]);
    expect(logged.some((message) => message.includes("container-a"))).toBe(
      true,
    );
  } finally {
    close();
  }
});

test("skips the pull when the rotation is already visible locally", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-no-redundant-pull",
  );
  try {
    await seedReadModel(execSql);
    const prepareCalls: RewrapCall[] = [];
    const rewrapped: string[] = [];
    let pulls = 0;
    await run({
      contents: fakeContainerContents({ prepareCalls, rewrapped }),
      execSql,
      reconcileReadModel: async () => {
        pulls += 1;
        return {};
      },
    });

    // The caller has usually just reconciled, so pulling again would be one
    // more request on every group mutation for nothing.
    expect(pulls).toBe(0);
    expect(rewrapped.toSorted()).toEqual(["container-a", "container-b"]);
  } finally {
    close();
  }
});

test("pulls, then enumerates, when the rotation is not visible yet", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-pull-then-enumerate",
  );
  try {
    await seedReadModel(execSql);
    const prepareCalls: RewrapCall[] = [];
    const rewrapped: string[] = [];
    const order: string[] = [];
    await reshareGroupContainerGrantsAfterRotation({
      containerContents: fakeContainerContents({
        order,
        prepareCalls,
        rewrapped,
      }),
      currentUserId: CURRENT_USER_ID,
      execSql,
      // Not the seeded head, so the local read has to fall back to a pull.
      expectedGroupHead: { ...EXPECTED_HEAD, stateHash: "not-local-yet" },
      log: () => undefined,
      mutatedGroupId: GRANTED_GROUP_ID,
      organizationId: ORGANIZATION_ID,
      reconcileReadModel: async () => {
        order.push("reconcile");
        return {};
      },
      shouldContinue: () => true,
    });

    // Enumeration reads the local cache, so a container visited before the
    // pull would have been chosen from a stale grant set.
    expect(order[0]).toBe("reconcile");
  } finally {
    close();
  }
});

test("does not pull at all when the rotation is already visible", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-reconcile-failure",
  );
  try {
    await seedReadModel(execSql);
    const prepareCalls: RewrapCall[] = [];
    const rewrapped: string[] = [];
    const outcome = await reshareGroupContainerGrantsAfterRotation({
      containerContents: fakeContainerContents({ prepareCalls, rewrapped }),
      currentUserId: CURRENT_USER_ID,
      execSql,
      expectedGroupHead: EXPECTED_HEAD,
      log: () => undefined,
      mutatedGroupId: GRANTED_GROUP_ID,
      organizationId: ORGANIZATION_ID,
      reconcileReadModel: async () => {
        throw new Error("this pull should never be attempted");
      },
      shouldContinue: () => true,
    });

    // The head is the evidence, and it is already here; a failing network is
    // irrelevant when nothing needs fetching.
    expect(outcome.headConfirmed).toBe(true);
    expect(rewrapped.toSorted()).toEqual(["container-a", "container-b"]);
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
      shouldContinue: () => true,
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
      shouldContinue: () => true,
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
      shouldContinue: () => true,
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

test("an unreadable group is never reported as a completed sweep", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-denied-projection",
  );
  try {
    await seedReadModel(execSql);
    const logged: string[] = [];
    const outcome = await reshareGroupContainerGrantsAfterRotation({
      containerContents: fakeContainerContents({
        prepareCalls: [],
        rewrapped: [],
      }),
      currentUserId: CURRENT_USER_ID,
      execSql,
      expectedGroupHead: EXPECTED_HEAD,
      log: (message) => logged.push(message),
      // A group this requester holds no readable projection for: the loader
      // returns null, which is denied/reset, not "no grants".
      mutatedGroupId: "group-with-no-readable-projection",
      organizationId: ORGANIZATION_ID,
      reconcileReadModel: async () => ({}),
      shouldContinue: () => true,
    });

    // Reporting complete would retire the sweep on the very race it exists to
    // survive, leaving the grants stale with nothing left to repair them.
    // The head lookup refuses first here, so this pins the outcome rather than
    // which of the two guards fired; the grant-projection guard covers the
    // case where a head is readable but its container grants are not.
    expect(outcome.complete).toBe(false);
    expect(logged.length).toBeGreaterThanOrEqual(0);
  } finally {
    close();
  }
});

test("a superseded sweep stops instead of retrying its window", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-superseded",
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
      // An older rotation than the one the read model now carries.
      expectedGroupHead: {
        ...EXPECTED_HEAD,
        stateHash: "older-rotation",
        version: EXPECTED_HEAD.version - 1,
      },
      log: (message) => logged.push(message),
      mutatedGroupId: GRANTED_GROUP_ID,
      organizationId: ORGANIZATION_ID,
      reconcileReadModel: async () => ({}),
      shouldContinue: () => true,
    });

    // This head can never become current again, so retrying the full window
    // would be pure request amplification. The newer rotation's own sweep owns
    // these containers.
    expect(outcome.complete).toBe(true);
    expect(prepareCalls).toEqual([]);
    expect(logged.some((m) => m.includes("superseded"))).toBe(true);
  } finally {
    close();
  }
});
