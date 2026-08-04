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
          resolve();
          return {};
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

test("stops retrying once the organization is no longer active", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-scope",
  );
  try {
    await seedReadModel(execSql);
    const log: string[] = [];
    const runtime = fakeRuntime(log);
    runtime.infra.execSql = execSql as never;
    const delays: number[] = [];
    let active = true;
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
      scheduleRetry: (retry, delayMs) => {
        delays.push(delayMs);
        // An org switch (or logout) lands between attempts.
        if (delays.length === 3) {
          active = false;
        }
        retry();
      },
      shouldContinue: () => active,
      signingContext: {
        organizationId: ORGANIZATION_ID,
        signerUserId: CURRENT_USER_ID,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Bounded by scope rather than an attempt cap, so a long outage keeps
    // retrying while a switched-away session does not.
    expect(delays).toEqual([1_000, 2_000, 4_000]);
    expect(log.some((m) => m.includes("no longer active"))).toBe(true);
    expect(log.some((m) => m.includes("container-a"))).toBe(true);
  } finally {
    close();
  }
});

test("stops permanently on an identity integrity failure", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-integrity",
  );
  try {
    await seedReadModel(execSql);
    const log: string[] = [];
    const runtime = fakeRuntime(log);
    runtime.infra.execSql = execSql as never;
    const delays: number[] = [];
    scheduleGroupGrantReshareAfterRotation({
      containerContents: fakeContainerContents({
        integrityFailureContainerIds: new Set(["container-a"]),
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

    // A verified projection disagreeing with a trusted identity is not
    // transient; re-attempting it just repeats a failing verification.
    expect(delays).toEqual([]);
    expect(log.some((m) => m.includes("identity integrity failure"))).toBe(
      true,
    );
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

test("stops when re-listing hits an identity integrity failure", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-refresh-integrity",
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
        refreshIntegrityFailure: true,
        rewrapped: [],
        throwForContainerIds: new Set(["container-a"]),
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

    // The sweep is discarded with void, so rethrowing here would surface as an
    // unhandled rejection instead of being reported anywhere.
    expect(delays).toEqual([1_000]);
    expect(
      log.some((m) => m.includes("integrity failure while re-listing")),
    ).toBe(true);
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
