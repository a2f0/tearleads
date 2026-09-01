import { expect, test } from "bun:test";
import {
  attachOrganizationReadModelSocket,
  ensureOrganizationReadModelReconciliation,
  handleOrganizationReadModelHint,
  scheduleOrganizationReadModelReconciliation,
  subscribeOrganizationReadModelRealtime,
} from "./organizationReadModelRealtime";
import {
  acknowledgeLatestDeclaration,
  createRuntimeHarness,
  fakeOpenSocket,
  ORGANIZATION_A,
  ORGANIZATION_B,
  parsedMessages,
  USER_B,
} from "./test/organizationReadModelRealtimeHarness";

test("coalesces a websocket burst and performs one trailing in-flight pass", async () => {
  let releaseFirst: (() => void) | undefined;
  let markFirstStarted: (() => void) | undefined;
  const first = new Promise<object>((resolve) => {
    releaseFirst = () => resolve({});
  });
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  let underlyingCalls = 0;
  const runtime = createRuntimeHarness({
    loadDirectoryAndGroups: () => {
      underlyingCalls += 1;
      if (underlyingCalls === 1) {
        markFirstStarted?.();
        return first;
      }
      return Promise.resolve({});
    },
  });
  let projectionUpdates = 0;
  subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => {
      projectionUpdates += 1;
    },
  );

  const active = scheduleOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );
  const sameBurst = scheduleOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );
  expect(active).toBe(sameBurst);
  await firstStarted;
  expect(runtime.reconcileCalls).toBe(1);

  const duringRequest = scheduleOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );
  expect(duringRequest).toBe(active);
  releaseFirst?.();
  await active;

  expect(runtime.reconcileCalls).toBe(2);
  expect(projectionUpdates).toBe(2);
  expect(runtime.containerCalls).toBe(0);
  expect(runtime.documentCalls).toBe(0);
});

test("initial consumer catch-up joins an active reconciliation without a trailing pass", async () => {
  let releaseRequest: (() => void) | undefined;
  let markRequestStarted: (() => void) | undefined;
  const request = new Promise<object>((resolve) => {
    releaseRequest = () => resolve({});
  });
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });
  const runtime = createRuntimeHarness({
    loadDirectoryAndGroups: () => {
      markRequestStarted?.();
      return request;
    },
  });
  subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => undefined,
  );

  const active = scheduleOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );
  await requestStarted;
  const joined = ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );
  expect(joined).toBe(active);
  releaseRequest?.();
  await joined;

  expect(runtime.reconcileCalls).toBe(1);
});

test("first exact demand owns catch-up until the last consumer leaves", async () => {
  const runtime = createRuntimeHarness();
  const subscribeWithCatchUp = () =>
    subscribeOrganizationReadModelRealtime(
      runtime.tearleads,
      ORGANIZATION_A,
      () => undefined,
    );

  const unsubscribeFirst = subscribeWithCatchUp();
  await ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );
  expect(runtime.reconcileCalls).toBe(1);

  const unsubscribeSecond = subscribeWithCatchUp();
  unsubscribeFirst();
  const unsubscribeThird = subscribeWithCatchUp();
  await Promise.resolve();
  expect(runtime.reconcileCalls).toBe(1);

  unsubscribeSecond();
  unsubscribeThird();
  const unsubscribeAfterGap = subscribeWithCatchUp();
  await ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );
  expect(runtime.reconcileCalls).toBe(2);
  unsubscribeAfterGap();
});

test("first-demand catch-up repaints consumers that join while it is in flight", async () => {
  let releaseRequest: (() => void) | undefined;
  let markRequestStarted: (() => void) | undefined;
  const request = new Promise<object>((resolve) => {
    releaseRequest = () => resolve({});
  });
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });
  const runtime = createRuntimeHarness({
    loadDirectoryAndGroups: () => {
      markRequestStarted?.();
      return request;
    },
  });
  let ownerUpdates = 0;
  let joiningConsumerUpdates = 0;
  const socket = fakeOpenSocket();
  const detach = attachOrganizationReadModelSocket(
    runtime.tearleads,
    socket.ws,
  );
  const unsubscribeOwner = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => {
      ownerUpdates += 1;
    },
  );
  const unsubscribeJoiningConsumer = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => {
      joiningConsumerUpdates += 1;
    },
  );
  acknowledgeLatestDeclaration(runtime.tearleads, socket);

  await requestStarted;
  const catchUp = ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );
  releaseRequest?.();
  await catchUp;

  expect(runtime.reconcileCalls).toBe(1);
  expect(ownerUpdates).toBe(1);
  expect(joiningConsumerUpdates).toBe(1);
  unsubscribeJoiningConsumer();
  unsubscribeOwner();
  detach();
});

for (const transition of ["user identity", "domain scope"] as const) {
  test(`same-organization ${transition} transition catches up only the current exact scope`, async () => {
    let releaseFirstRequest: (() => void) | undefined;
    let markFirstRequestStarted: (() => void) | undefined;
    const firstRequest = new Promise<object>((resolve) => {
      releaseFirstRequest = () => resolve({});
    });
    const firstRequestStarted = new Promise<void>((resolve) => {
      markFirstRequestStarted = resolve;
    });
    let inFlight = 0;
    let maxInFlight = 0;
    let underlyingCalls = 0;
    const runtime = createRuntimeHarness({
      loadDirectoryAndGroups: async () => {
        underlyingCalls += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (underlyingCalls === 1) {
          markFirstRequestStarted?.();
          await firstRequest;
        }
        inFlight -= 1;
        return {};
      },
    });
    let staleProjectionUpdates = 0;
    let currentProjectionUpdates = 0;
    subscribeOrganizationReadModelRealtime(
      runtime.tearleads,
      ORGANIZATION_A,
      () => {
        staleProjectionUpdates += 1;
      },
    );

    const stalePass = scheduleOrganizationReadModelReconciliation(
      runtime.tearleads,
      ORGANIZATION_A,
    );
    await firstRequestStarted;
    if (transition === "user identity") {
      runtime.setUserId(USER_B);
    } else {
      runtime.transitionDomainScope();
    }
    subscribeOrganizationReadModelRealtime(
      runtime.tearleads,
      ORGANIZATION_A,
      () => {
        currentProjectionUpdates += 1;
      },
    );

    releaseFirstRequest?.();
    await stalePass;

    expect(runtime.reconcileCalls).toBe(2);
    expect(maxInFlight).toBe(1);
    expect(staleProjectionUpdates).toBe(0);
    expect(currentProjectionUpdates).toBe(1);
  });
}

test("a newly demanded scope is handed off across reconciliation finalization", async () => {
  const runtime = createRuntimeHarness();
  const socket = fakeOpenSocket();
  const detach = attachOrganizationReadModelSocket(
    runtime.tearleads,
    socket.ws,
  );
  const unsubscribeStale = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => undefined,
  );
  acknowledgeLatestDeclaration(runtime.tearleads, socket);
  unsubscribeStale();
  runtime.transitionDomainScope();

  let unsubscribeCurrent: (() => void) | undefined;
  await Promise.resolve().then(() => {
    unsubscribeCurrent = subscribeOrganizationReadModelRealtime(
      runtime.tearleads,
      ORGANIZATION_A,
      () => undefined,
    );
    acknowledgeLatestDeclaration(runtime.tearleads, socket);
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(runtime.reconcileCalls).toBe(1);
  unsubscribeCurrent?.();
  detach();
});

test("an unmounted mutation owner releases its deferred hint to remaining demand", async () => {
  const runtime = createRuntimeHarness();
  const socket = fakeOpenSocket();
  const detach = attachOrganizationReadModelSocket(
    runtime.tearleads,
    socket.ws,
  );
  let explorerUpdates = 0;
  const unsubscribeExplorer = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => {
      explorerUpdates += 1;
    },
  );
  acknowledgeLatestDeclaration(runtime.tearleads, socket);
  let mutating = true;
  const unsubscribeMutationOwner = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => undefined,
    {
      isMutationActive: () => mutating,
    },
  );
  await ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );
  expect(runtime.reconcileCalls).toBe(1);

  handleOrganizationReadModelHint(runtime.tearleads, ORGANIZATION_A, true);
  unsubscribeMutationOwner();
  mutating = false;
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(runtime.reconcileCalls).toBe(2);
  expect(explorerUpdates).toBe(2);
  unsubscribeExplorer();
  detach();
});

test("ignores undemanded scope and catches up demanded scope on reconnect", async () => {
  const runtime = createRuntimeHarness();
  const unsubscribe = subscribeOrganizationReadModelRealtime(
    runtime.tearleads,
    ORGANIZATION_A,
    () => undefined,
  );
  const firstSocket = fakeOpenSocket();
  const detachFirst = attachOrganizationReadModelSocket(
    runtime.tearleads,
    firstSocket.ws,
  );
  acknowledgeLatestDeclaration(runtime.tearleads, firstSocket);
  await ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );

  await scheduleOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_B,
  );
  expect(runtime.reconcileCalls).toBe(1);

  detachFirst();
  const secondSocket = fakeOpenSocket();
  const detachSecond = attachOrganizationReadModelSocket(
    runtime.tearleads,
    secondSocket.ws,
  );
  acknowledgeLatestDeclaration(runtime.tearleads, secondSocket);
  await ensureOrganizationReadModelReconciliation(
    runtime.tearleads,
    ORGANIZATION_A,
  );

  expect(parsedMessages(firstSocket.sent)).toEqual([
    {
      type: "known_organizations",
      declarationId: "1",
      organizationIds: [ORGANIZATION_A],
    },
  ]);
  expect(parsedMessages(secondSocket.sent)).toEqual([
    {
      type: "known_organizations",
      declarationId: "2",
      organizationIds: [ORGANIZATION_A],
    },
  ]);
  expect(runtime.reconcileCalls).toBe(2);

  detachSecond();
  unsubscribe();
});
