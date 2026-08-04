import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ExecSql } from "../data/sqlite/sqlSchema";
import type { ContainerContents } from "./containerContents";
import {
  reshareGroupContainerGrantsAfterRotation,
  withGroupGrantReshareAfterRotation,
} from "./organizationGroupGrantReshare";
import {
  CURRENT_USER_ID,
  EXPECTED_HEAD,
  fakeContainerContents,
  fakeRuntime,
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
    reconcileReadModel: input.reconcileReadModel ?? (async () => undefined),
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
      reconcileReadModel: async () => undefined,
    });

    expect(rewrapped).toEqual(["container-b"]);
    expect(logged.some((message) => message.includes("container-a"))).toBe(
      true,
    );
  } finally {
    close();
  }
});

test("reconciles the read model before enumerating grants", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-reconcile",
  );
  try {
    await seedReadModel(execSql);
    const prepareCalls: RewrapCall[] = [];
    const rewrapped: string[] = [];
    const order: string[] = [];
    await run({
      contents: fakeContainerContents({
        prepareCalls,
        rewrapped,
      }),
      execSql,
      reconcileReadModel: async () => {
        order.push("reconcile");
        return undefined;
      },
    });

    // A grant created since the last pull is absent from the cached read model,
    // so enumerating first would never visit its container.
    expect(order).toEqual(["reconcile"]);
    expect(rewrapped.length).toBeGreaterThan(0);
  } finally {
    close();
  }
});

test("sweeps the cached grants when the read-model pull fails", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-reconcile-failure",
  );
  try {
    await seedReadModel(execSql);
    const prepareCalls: RewrapCall[] = [];
    const rewrapped: string[] = [];
    const logged: string[] = [];
    await reshareGroupContainerGrantsAfterRotation({
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

    // Offline must degrade to sweeping what is known, not to sweeping nothing.
    expect(rewrapped.toSorted()).toEqual(["container-a", "container-b"]);
    expect(logged.some((message) => message.includes("stale read model"))).toBe(
      true,
    );
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
      reconcileReadModel: async () => undefined,
    });

    // Unavailable is not "not-granted": the grant is neither confirmed nor
    // refuted, so staying silent would read as a clean sweep.
    expect(logged.filter((m) => m.includes("unavailable")).length).toBe(2);
  } finally {
    close();
  }
});

test("sweeps a rotation whose mutation rejected after committing", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-post-commit-failure",
  );
  try {
    await seedReadModel(execSql);
    const prepareCalls: RewrapCall[] = [];
    const rewrapped: string[] = [];
    const log: string[] = [];
    let reconciled = false;
    const swept = new Promise<void>((resolve) => {
      const runtime = fakeRuntime(log);
      runtime.infra.execSql = execSql as never;
      const boom = new Error("cache write failed after the policy committed");
      void withGroupGrantReshareAfterRotation({
        containerContents: fakeContainerContents({ prepareCalls, rewrapped }),
        mutatedGroupId: GRANTED_GROUP_ID,
        mutation: Promise.reject(boom),
        // The head is captured before the rejection, so the policy did commit.
        readExpectedGroupHead: () => EXPECTED_HEAD,
        reconcileReadModel: async () => {
          reconciled = true;
          resolve();
          return undefined;
        },
        runtime: runtime as never,
        signingContext: {
          organizationId: ORGANIZATION_ID,
          signerUserId: CURRENT_USER_ID,
        },
      }).catch(() => undefined);
    });
    await swept;

    // recoverOrganizationRootRewrapAfterMutationFailure rethrows the original
    // error after a post-commit failure. The group has still rotated, so the
    // stale grants must be swept from the throwing path too.
    expect(reconciled).toBe(true);
  } finally {
    close();
  }
});

test("rethrows the mutation error rather than swallowing it", async () => {
  const log: string[] = [];
  const runtime = fakeRuntime(log);
  const boom = new Error("policy commit failed");
  expect(
    withGroupGrantReshareAfterRotation({
      containerContents: fakeContainerContents({
        prepareCalls: [],
        rewrapped: [],
      }),
      mutatedGroupId: GRANTED_GROUP_ID,
      mutation: Promise.reject(boom),
      // No head captured: the commit never happened, so nothing is swept.
      readExpectedGroupHead: () => null,
      reconcileReadModel: async () => {
        throw new Error("must not reconcile without a committed head");
      },
      runtime: runtime as never,
      signingContext: {
        organizationId: ORGANIZATION_ID,
        signerUserId: CURRENT_USER_ID,
      },
    }),
  ).rejects.toThrow("policy commit failed");
});
