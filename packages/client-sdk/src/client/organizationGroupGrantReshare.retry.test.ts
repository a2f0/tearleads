import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  scheduleGroupGrantReshareAfterRotation,
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
          return {};
        },
        scheduleRetry: () => undefined,
        shouldContinue: () => true,
        runtime: runtime as never,
        signingContext: {
          organizationId: ORGANIZATION_ID,
          signerUserId: CURRENT_USER_ID,
        },
      })
        .catch(() => undefined)
        .finally(() => resolve());
    });
    await swept;
    await new Promise((settle) => setTimeout(settle, 50));

    // recoverOrganizationRootRewrapAfterMutationFailure rethrows the original
    // error after a post-commit failure. The group has still rotated, so the
    // stale grants must be swept from the throwing path too — and the assertion
    // is on the repair landing, not merely on the sweep having started.
    expect(reconciled).toBe(true);
    expect(rewrapped.toSorted()).toEqual(["container-a", "container-b"]);
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

test("retries until every granted container resolves", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-retry",
  );
  try {
    await seedReadModel(execSql);
    const log: string[] = [];
    const runtime = fakeRuntime(log);
    runtime.infra.execSql = execSql as never;
    const rewrapped: string[] = [];
    const delays: number[] = [];
    // container-a is unreachable until the first retry is scheduled.
    let transientFailure = true;
    scheduleGroupGrantReshareAfterRotation({
      containerContents: fakeContainerContents({
        prepareCalls: [],
        rewrapped,
        get throwForContainerIds() {
          return transientFailure
            ? new Set(["container-a"])
            : new Set<string>();
        },
      }),
      expectedGroupHead: EXPECTED_HEAD,
      mutatedGroupId: GRANTED_GROUP_ID,
      reconcileReadModel: async () => ({}),
      runtime: runtime as never,
      scheduleRetry: (retry, delayMs) => {
        delays.push(delayMs);
        transientFailure = false;
        retry();
      },
      signingContext: {
        organizationId: ORGANIZATION_ID,
        signerUserId: CURRENT_USER_ID,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    // A transient failure must not strand the container: the members this
    // repair exists for stay locked out of anything left pinned.
    expect(rewrapped).toContain("container-a");
    expect(delays).toEqual([1_000]);
    expect(log.some((m) => m.includes("gave up"))).toBe(false);
  } finally {
    close();
  }
});

test("re-lists containers between attempts so a late one is found", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-refresh",
  );
  try {
    await seedReadModel(execSql);
    const log: string[] = [];
    const runtime = fakeRuntime(log);
    runtime.infra.execSql = execSql as never;
    const rewrapped: string[] = [];
    let hydrated = false;
    scheduleGroupGrantReshareAfterRotation({
      containerContents: fakeContainerContents({
        // container-a is not in the hydrated store until refresh() runs.
        get unavailableContainerIds() {
          return hydrated ? new Set<string>() : new Set(["container-a"]);
        },
        onRefresh: () => {
          hydrated = true;
        },
        prepareCalls: [],
        rewrapped,
      }),
      expectedGroupHead: EXPECTED_HEAD,
      mutatedGroupId: GRANTED_GROUP_ID,
      reconcileReadModel: async () => ({}),
      runtime: runtime as never,
      scheduleRetry: (retry) => retry(),
      shouldContinue: () => true,
      signingContext: {
        organizationId: ORGANIZATION_ID,
        signerUserId: CURRENT_USER_ID,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    // A grant naming a container this device never hydrated resolves as
    // unavailable, not as a missing grant. Without the re-list it stays that
    // way forever.
    expect(rewrapped).toContain("container-a");
  } finally {
    close();
  }
});

test("gives up confirming a rotation that never committed", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-unconfirmed-giveup",
  );
  try {
    await seedReadModel(execSql);
    const log: string[] = [];
    const runtime = fakeRuntime(log);
    runtime.infra.execSql = execSql as never;
    const delays: number[] = [];
    scheduleGroupGrantReshareAfterRotation({
      containerContents: fakeContainerContents({
        prepareCalls: [],
        rewrapped: [],
      }),
      expectedGroupHead: { ...EXPECTED_HEAD, stateHash: "never-committed" },
      mutatedGroupId: GRANTED_GROUP_ID,
      reconcileReadModel: async () => ({}),
      runtime: runtime as never,
      scheduleRetry: (retry, delayMs) => {
        delays.push(delayMs);
        retry();
      },
      shouldContinue: () => true,
      signingContext: {
        organizationId: ORGANIZATION_ID,
        signerUserId: CURRENT_USER_ID,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Bounded: a head that never committed will never appear, so retrying it
    // forever is retrying nothing. Repair failures stay unbounded.
    expect(delays.length).toBe(4);
    expect(log.some((m) => m.includes("did not commit"))).toBe(true);
  } finally {
    close();
  }
});

test("keeps confirming across an outage that never lands a pull", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-outage",
  );
  try {
    await seedReadModel(execSql);
    const log: string[] = [];
    const runtime = fakeRuntime(log);
    runtime.infra.execSql = execSql as never;
    const delays: number[] = [];
    let offline = true;
    scheduleGroupGrantReshareAfterRotation({
      containerContents: fakeContainerContents({
        prepareCalls: [],
        rewrapped: [],
      }),
      // A head the seeded read model does not carry yet.
      expectedGroupHead: { ...EXPECTED_HEAD, stateHash: "arrives-late" },
      mutatedGroupId: GRANTED_GROUP_ID,
      // Declines while offline, exactly as reconcileAfterMutation does.
      reconcileReadModel: async () => (offline ? undefined : {}),
      runtime: runtime as never,
      scheduleRetry: (retry, delayMs) => {
        delays.push(delayMs);
        // Ten failed pulls: more than the confirmation budget of 5.
        if (delays.length === 10) {
          offline = false;
        }
        retry();
      },
      shouldContinue: () => delays.length < 20,
      signingContext: {
        organizationId: ORGANIZATION_ID,
        signerUserId: CURRENT_USER_ID,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    // A pull that never landed teaches nothing about whether the rotation
    // committed, so it must not burn the confirmation budget — otherwise a
    // long outage permanently abandons a rotation that did commit.
    expect(delays.length).toBeGreaterThan(10);
    expect(log.some((m) => m.includes("did not commit"))).toBe(true);
  } finally {
    close();
  }
});

test("stops when this signer cannot re-wrap the containers", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-unauthorized",
  );
  try {
    await seedReadModel(execSql);
    const log: string[] = [];
    const runtime = fakeRuntime(log);
    runtime.infra.execSql = execSql as never;
    const delays: number[] = [];
    scheduleGroupGrantReshareAfterRotation({
      containerContents: fakeContainerContents({
        forbiddenContainerIds: new Set(["container-a"]),
        prepareCalls: [],
        rewrapped: [],
      }),
      expectedGroupHead: EXPECTED_HEAD,
      mutatedGroupId: GRANTED_GROUP_ID,
      reconcileReadModel: async () => ({}),
      runtime: runtime as never,
      scheduleRetry: (retry, delayMs) => {
        delays.push(delayMs);
        retry();
      },
      shouldContinue: () => true,
      signingContext: {
        organizationId: ORGANIZATION_ID,
        signerUserId: CURRENT_USER_ID,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    // A direct group admin may rotate membership without container access.
    // Retrying cannot change that, so the sweep stops — but only after the
    // containers it COULD repair were repaired.
    expect(delays).toEqual([]);
    expect(log.some((m) => m.includes("may not re-wrap"))).toBe(true);
  } finally {
    close();
  }
});

test("gives up once retries have sat at the ceiling", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-ceiling",
  );
  try {
    await seedReadModel(execSql);
    const log: string[] = [];
    const runtime = fakeRuntime(log);
    runtime.infra.execSql = execSql as never;
    let attempts = 0;
    scheduleGroupGrantReshareAfterRotation({
      containerContents: fakeContainerContents({
        prepareCalls: [],
        rewrapped: [],
        throwForContainerIds: new Set(["container-a", "container-b"]),
      }),
      expectedGroupHead: EXPECTED_HEAD,
      mutatedGroupId: GRANTED_GROUP_ID,
      reconcileReadModel: async () => ({}),
      runtime: runtime as never,
      scheduleRetry: (retry) => {
        attempts += 1;
        retry();
      },
      shouldContinue: () => true,
      signingContext: {
        organizationId: ORGANIZATION_ID,
        signerUserId: CURRENT_USER_ID,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    // A signer who may rotate the group but cannot re-wrap its containers
    // surfaces as an ordinary unapplied re-wrap, because the share path turns
    // an authorization failure into a null result rather than a status. The
    // window is what stops that from retrying forever.
    expect(attempts).toBeLessThan(60);
    expect(log.some((m) => m.includes("gave up"))).toBe(true);
    expect(log.some((m) => m.includes("container-a"))).toBe(true);
  } finally {
    close();
  }
});
