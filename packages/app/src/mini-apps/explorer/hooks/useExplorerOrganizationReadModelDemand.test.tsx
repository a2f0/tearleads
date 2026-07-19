import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type {
  DomainScope,
  OrganizationDirectoryAndGroups,
  Tearleads,
} from "@tearleads/client-sdk";
import { createDomainScope } from "@tearleads/client-sdk";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  attachOrganizationReadModelSocket,
  handleOrganizationReadModelInterestAcknowledgement,
} from "../../../providers/sdk/organizationReadModelRealtime";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import * as TearleadsProvider from "../../../providers/sdk/TearleadsProvider";
import { useExplorerOrganizationReadModelDemand } from "./useExplorerOrganizationReadModelDemand";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const USER_A = "00000000-0000-4000-8000-000000000002";
const USER_B = "00000000-0000-4000-8000-000000000003";

afterEach(() => cleanup());

function projection(): OrganizationDirectoryAndGroups {
  return {
    directory: {
      currentUser: { isOrgAdmin: true },
      organizationId: ORGANIZATION_ID,
      profileDocumentId: null,
      users: [],
    },
    groups: [],
    memberGroupId: "members-group-id",
    readModelCursor: "cursor-1",
  };
}

function runtimeSnapshot(input: {
  readonly authenticated?: boolean;
  readonly dbStatus?: string;
  readonly domainScope: DomainScope;
  readonly online?: boolean;
  readonly userId?: string;
}): RuntimeSnapshot {
  const authenticated = input.authenticated ?? true;
  return {
    auth: {
      authToken: authenticated ? "token" : null,
      isAuthenticated: authenticated,
      organizationId: ORGANIZATION_ID,
      userId: input.userId ?? USER_A,
    },
    // The real runtime always pairs a ready database with an ExecSql function.
    infra: {
      dbStatus: input.dbStatus ?? "ready",
      execSql: async () => [],
    },
    state: {
      domainScope: input.domainScope,
      online: input.online ?? true,
    },
  } as unknown as RuntimeSnapshot;
}

function createHarness(initialRuntime: RuntimeSnapshot) {
  let runtime = initialRuntime;
  let blockReconciliation = false;
  const blockedReconciliation = new Promise<never>(() => undefined);
  const readModel = projection();
  const loadDirectoryAndGroups = mock(() =>
    blockReconciliation ? blockedReconciliation : Promise.resolve(readModel),
  );
  const loadLocalDirectoryAndGroups = mock(() => Promise.resolve(readModel));
  const tearleads = {
    organizations: {
      loadDirectoryAndGroups,
      loadDirectoryAndGroupsAfterMutation: loadDirectoryAndGroups,
      loadLocalDirectoryAndGroups,
    },
    runtime: { input: () => runtime },
  } as unknown as Tearleads;
  return {
    blockFutureReconciliation() {
      blockReconciliation = true;
    },
    readModel,
    setRuntime(nextRuntime: RuntimeSnapshot) {
      runtime = nextRuntime;
    },
    tearleads,
  };
}

function connectAcknowledgingSocket(tearleads: Tearleads): () => void {
  let ws: WebSocket;
  ws = {
    readyState: WebSocket.OPEN,
    send: (rawMessage: string) => {
      const message = JSON.parse(rawMessage) as {
        declarationId?: unknown;
        organizationIds?: unknown;
      };
      if (
        typeof message.declarationId !== "string" ||
        !Array.isArray(message.organizationIds)
      ) {
        return;
      }
      const organizationId = message.organizationIds[0];
      queueMicrotask(() => {
        handleOrganizationReadModelInterestAcknowledgement(
          tearleads,
          ws,
          message.declarationId as string,
          typeof organizationId === "string" ? organizationId : null,
          true,
        );
      });
    },
  } as unknown as WebSocket;
  return attachOrganizationReadModelSocket(tearleads, ws);
}

test("logout and database loss invalidate cached presentation while offline preserves it", async () => {
  const domainScope = createDomainScope();
  const initialRuntime = runtimeSnapshot({ domainScope });
  const harness = createHarness(initialRuntime);
  const useTearleadsSpy = spyOn(
    TearleadsProvider,
    "useTearleads",
  ).mockImplementation(() => harness.tearleads);
  const disconnect = connectAcknowledgingSocket(harness.tearleads);

  try {
    const view = renderHook(
      (appData: RuntimeSnapshot) =>
        useExplorerOrganizationReadModelDemand({ appData, enabled: true }),
      { initialProps: initialRuntime },
    );
    await waitFor(() => expect(view.result.current.revision).toBe(1));
    const warmScope = view.result.current.scope;

    const offlineRuntime = runtimeSnapshot({ domainScope, online: false });
    harness.setRuntime(offlineRuntime);
    view.rerender(offlineRuntime);
    expect(view.result.current).toEqual({
      projection: harness.readModel,
      revision: 1,
      scope: warmScope,
    });

    const loggedOutRuntime = runtimeSnapshot({
      authenticated: false,
      domainScope,
      online: false,
    });
    harness.setRuntime(loggedOutRuntime);
    view.rerender(loggedOutRuntime);
    expect(view.result.current).toEqual({
      projection: null,
      revision: 0,
      scope: null,
    });

    const unavailableDatabaseRuntime = runtimeSnapshot({
      dbStatus: "idle",
      domainScope,
      online: false,
    });
    harness.setRuntime(unavailableDatabaseRuntime);
    view.rerender(unavailableDatabaseRuntime);
    expect(view.result.current).toEqual({
      projection: null,
      revision: 0,
      scope: null,
    });
  } finally {
    cleanup();
    disconnect();
    useTearleadsSpy.mockRestore();
  }
});

test("same-organization user transition invalidates revision-zero presentation", async () => {
  const domainScope = createDomainScope();
  const initialRuntime = runtimeSnapshot({ domainScope, userId: USER_A });
  const harness = createHarness(initialRuntime);
  const useTearleadsSpy = spyOn(
    TearleadsProvider,
    "useTearleads",
  ).mockImplementation(() => harness.tearleads);
  const disconnect = connectAcknowledgingSocket(harness.tearleads);

  try {
    const view = renderHook(
      (appData: RuntimeSnapshot) =>
        useExplorerOrganizationReadModelDemand({ appData, enabled: true }),
      { initialProps: initialRuntime },
    );
    await waitFor(() => expect(view.result.current.revision).toBe(1));
    harness.blockFutureReconciliation();

    const nextRuntime = runtimeSnapshot({ domainScope, userId: USER_B });
    harness.setRuntime(nextRuntime);
    view.rerender(nextRuntime);
    expect(view.result.current.projection).toBeNull();
    expect(view.result.current.revision).toBe(0);
    expect(view.result.current.scope?.userId).toBe(USER_B);
  } finally {
    cleanup();
    disconnect();
    useTearleadsSpy.mockRestore();
  }
});

test("same-identity domain transition invalidates revision-zero presentation", async () => {
  const firstDomainScope = createDomainScope();
  const initialRuntime = runtimeSnapshot({ domainScope: firstDomainScope });
  const harness = createHarness(initialRuntime);
  const useTearleadsSpy = spyOn(
    TearleadsProvider,
    "useTearleads",
  ).mockImplementation(() => harness.tearleads);
  const disconnect = connectAcknowledgingSocket(harness.tearleads);

  try {
    const view = renderHook(
      (appData: RuntimeSnapshot) =>
        useExplorerOrganizationReadModelDemand({ appData, enabled: true }),
      { initialProps: initialRuntime },
    );
    await waitFor(() => expect(view.result.current.revision).toBe(1));
    harness.blockFutureReconciliation();

    const secondDomainScope = createDomainScope();
    const nextRuntime = runtimeSnapshot({ domainScope: secondDomainScope });
    harness.setRuntime(nextRuntime);
    view.rerender(nextRuntime);
    expect(view.result.current.projection).toBeNull();
    expect(view.result.current.revision).toBe(0);
    expect(view.result.current.scope?.domainScope).toBe(secondDomainScope);
  } finally {
    cleanup();
    disconnect();
    useTearleadsSpy.mockRestore();
  }
});
