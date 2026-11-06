import { describe, expect, test } from "bun:test";
import {
  createNoopSqlClient,
  quietLogger,
} from "../test/helpers/clientTestSupport";
import { type SessionSnapshot, Tearleads } from ".";

describe("Tearleads", () => {
  test("notifies database subscribers with stable snapshots", () => {
    const sdk = new Tearleads({ logger: quietLogger });
    const sqlClient = createNoopSqlClient();
    const snapshots: Array<{
      id: string | null;
      status: string;
    }> = [];
    const unsubscribe = sdk.database.subscribe(() => {
      snapshots.push({
        id: sdk.database.snapshot.id,
        status: sdk.database.snapshot.status,
      });
    });

    sdk.database.configure({
      client: sqlClient,
      id: "client-db",
    });
    sdk.database.configure({
      client: sqlClient,
      id: "client-db",
    });
    sdk.database.clear("terminated");
    unsubscribe();
    sdk.database.clear();

    expect(snapshots).toEqual([
      { id: "client-db", status: "ready" },
      { id: null, status: "terminated" },
    ]);
  });

  test("notifies network subscribers when online state changes", () => {
    const sdk = new Tearleads({ logger: quietLogger, online: true });
    const snapshots: boolean[] = [];
    const unsubscribe = sdk.network.subscribe((online) => {
      snapshots.push(online);
    });

    sdk.network.setOnline(false);
    sdk.network.setOnline(false);
    sdk.network.setOnline(true);
    unsubscribe();
    sdk.network.setOnline(false);

    expect(snapshots).toEqual([false, true]);
    expect(sdk.network.online).toBe(false);
  });

  test("continues notifying network subscribers after listener failure", () => {
    const sdk = new Tearleads({ logger: quietLogger, online: true });
    const snapshots: boolean[] = [];
    sdk.network.subscribe(() => {
      throw new Error("listener failed");
    });
    sdk.network.subscribe((online) => {
      snapshots.push(online);
    });

    expect(() => sdk.network.setOnline(false)).not.toThrow();

    expect(snapshots).toEqual([false]);
    expect(sdk.network.online).toBe(false);
  });

  test("manual network mode overrides detected connectivity changes", () => {
    const sdk = new Tearleads({ logger: quietLogger, online: true });
    const snapshots: boolean[] = [];
    sdk.network.subscribe((online) => {
      snapshots.push(online);
    });

    sdk.network.setMode("offline");
    sdk.network.setOnline(true);
    sdk.network.setMode("online");
    sdk.network.setOnline(false);
    sdk.network.setMode("automatic");

    expect(snapshots).toEqual([false, true, false]);
    expect(sdk.network.detectedOnline).toBe(false);
    expect(sdk.network.mode).toBe("automatic");
    expect(sdk.network.online).toBe(false);
  });

  test("notifies network subscribers when mode changes without changing effective online state", () => {
    const sdk = new Tearleads({ logger: quietLogger, online: true });
    const snapshots: boolean[] = [];
    sdk.network.subscribe((online) => {
      snapshots.push(online);
    });

    sdk.network.setMode("online");

    expect(snapshots).toEqual([true]);
    expect(sdk.network.mode).toBe("online");
    expect(sdk.network.online).toBe(true);
  });

  test("notifies event subscribers with stable snapshots", () => {
    const sdk = new Tearleads({ logger: quietLogger });
    const snapshots: ReadonlyArray<unknown>[] = [];
    expect(sdk.runtime.input().state.serverEventsConnectionGeneration).toBe(0);
    const unsubscribe = sdk.events.subscribe(() => {
      snapshots.push(sdk.events.snapshot.events);
    });

    sdk.events.push({ type: "document.updated" });
    sdk.events.setConnected(true);
    sdk.events.setConnected(true);
    sdk.events.setConnected(false);
    sdk.events.setConnected(true);
    unsubscribe();
    sdk.events.push({ type: "ignored" });

    expect(snapshots).toEqual([
      [{ type: "document.updated" }],
      [{ type: "document.updated" }],
      [{ type: "document.updated" }],
      [{ type: "document.updated" }],
    ]);
    expect(sdk.events.connected).toBe(true);
    expect(sdk.events.connectionGeneration).toBe(2);
    expect(sdk.runtime.input().state.serverEventsConnectionGeneration).toBe(2);
  });

  test("continues notifying event subscribers after listener failure", () => {
    const sdk = new Tearleads({ logger: quietLogger });
    let notifications = 0;
    sdk.events.subscribe(() => {
      throw new Error("listener failed");
    });
    sdk.events.subscribe(() => {
      notifications += 1;
    });

    expect(() => sdk.events.push({ type: "document.updated" })).not.toThrow();

    expect(notifications).toBe(1);
  });

  test("notifies session and runtime subscribers from SDK state changes", () => {
    const sdk = new Tearleads({ logger: quietLogger, online: true });
    const sessionSnapshots: SessionSnapshot[] = [];
    const runtimeVersions: number[] = [];
    const unsubscribeSession = sdk.session.subscribe(() => {
      sessionSnapshots.push(sdk.session.snapshot);
    });
    const unsubscribeRuntime = sdk.runtime.subscribe(() => {
      runtimeVersions.push(sdk.runtime.version);
    });

    sdk.session.setContext({
      containerId: "container-1",
      defaultOrganizationId: "organization-1",
      organizationId: "organization-1",
      userId: "user-1",
    });
    sdk.session.setContext({
      containerId: "container-1",
      organizationId: "organization-1",
      userId: "user-1",
    });
    sdk.session.setContext({
      authToken: "session-token",
      isAuthenticated: true,
    });
    sdk.network.setOnline(false);
    unsubscribeSession();
    unsubscribeRuntime();
    sdk.session.logout();

    expect(sdk.runtime.input().state.containerId).toBe("container-1");
    expect(sessionSnapshots).toEqual([
      {
        authToken: null,
        containerId: "container-1",
        defaultOrganizationId: "organization-1",
        isAuthenticated: false,
        isRoot: false,
        rootAcknowledgments: [],
        organizationId: "organization-1",
        userId: "user-1",
      },
      {
        authToken: "session-token",
        containerId: "container-1",
        defaultOrganizationId: "organization-1",
        isAuthenticated: true,
        isRoot: false,
        rootAcknowledgments: [],
        organizationId: "organization-1",
        userId: "user-1",
      },
    ]);
    expect(runtimeVersions).toEqual([1, 2, 3]);
  });
});
