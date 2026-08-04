import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { scheduleGroupGrantReshareAfterRotation } from "./organizationGroupGrantReshare";
import {
  CURRENT_USER_ID,
  EXPECTED_HEAD,
  fakeContainerContents,
  fakeRuntime,
  GRANTED_GROUP_ID,
  ORGANIZATION_ID,
  seedReadModel,
} from "./organizationGroupGrantReshare.testFixtures";

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

test("does not re-list after the scope changes during the backoff", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-switch-during-backoff",
  );
  try {
    await seedReadModel(execSql);
    const log: string[] = [];
    const runtime = fakeRuntime(log);
    runtime.infra.execSql = execSql as never;
    let refreshes = 0;
    let active = true;
    scheduleGroupGrantReshareAfterRotation({
      containerContents: fakeContainerContents({
        onRefresh: () => {
          refreshes += 1;
        },
        prepareCalls: [],
        rewrapped: [],
        throwForContainerIds: new Set(["container-a", "container-b"]),
      }),
      expectedGroupHead: EXPECTED_HEAD,
      mutatedGroupId: GRANTED_GROUP_ID,
      reconcileReadModel: async () => ({}),
      runtime: runtime as never,
      scheduleRetry: (retry) => {
        // The org switch lands while the backoff timer is pending.
        active = false;
        retry();
      },
      shouldContinue: () => active,
      signingContext: {
        organizationId: ORGANIZATION_ID,
        signerUserId: CURRENT_USER_ID,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Re-listing after the switch would refresh the organization just moved
    // to, on behalf of a sweep that no longer applies to it.
    expect(refreshes).toBe(0);
    expect(log.some((m) => m.includes("no longer active"))).toBe(true);
  } finally {
    close();
  }
});

test("stops mid-loop when the scope changes between containers", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-grant-reshare-switch-mid-loop",
  );
  try {
    await seedReadModel(execSql);
    const log: string[] = [];
    const runtime = fakeRuntime(log);
    runtime.infra.execSql = execSql as never;
    const rewrapped: string[] = [];
    let active = true;
    scheduleGroupGrantReshareAfterRotation({
      containerContents: fakeContainerContents({
        onPrepare: () => {
          // The switch lands after the first container is handled.
          active = false;
        },
        prepareCalls: [],
        rewrapped,
      }),
      expectedGroupHead: EXPECTED_HEAD,
      mutatedGroupId: GRANTED_GROUP_ID,
      reconcileReadModel: async () => ({}),
      runtime: runtime as never,
      scheduleRetry: () => undefined,
      shouldContinue: () => active,
      signingContext: {
        organizationId: ORGANIZATION_ID,
        signerUserId: CURRENT_USER_ID,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 60));

    // A write issued after the switch would be this organization's repair
    // travelling through another scope's runtime.
    expect(rewrapped.length).toBeLessThan(2);
  } finally {
    close();
  }
});
