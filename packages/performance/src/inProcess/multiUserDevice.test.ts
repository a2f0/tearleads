import { expect, test } from "bun:test";
import type { Tearleads } from "@tearleads/client-sdk";
import {
  type ExportedKeyPackage,
  MultiUserDevice,
  type MultiUserDeviceServices,
} from "./multiUserDevice";

function fakeLocalDb(events: string[]) {
  return {
    client: {
      exec: async () => ({ rows: [] }),
    },
    measurements: { calls: 0, durationMs: 0 },
    captureSqlWindow: () => ({
      finish: () => ({
        top: [],
        mutations: 0,
        maxMutationHoldMs: 0,
        maxStatementsPerMutation: 0,
      }),
    }),
    close: () => {
      events.push("db.close");
    },
  };
}

function fakeKeyPackage(): ExportedKeyPackage {
  return {
    version: 1,
    signingSeedHex: "00",
    encapsulationSeedHex: "00",
  } as unknown as ExportedKeyPackage;
}

test("closes local database if createSdkHost throws during open", async () => {
  const events: string[] = [];
  const services: MultiUserDeviceServices = {
    openLocalDatabase: async () => fakeLocalDb(events),
    createSdkHost: () => {
      throw new Error("sdk boom");
    },
  };
  await expect(
    MultiUserDevice.register(
      "http://127.0.0.1:4001",
      "http://127.0.0.1:4000",
      "alice",
      services,
    ),
  ).rejects.toThrow("sdk boom");
  expect(events).toEqual(["db.close"]);
});

test("disposes SDK and local database when register or login fails", async () => {
  const events: string[] = [];
  const makeSdk = (options: {
    readonly registerOk: boolean;
    readonly loginOk: boolean;
  }) =>
    ({
      identity: {
        generate: async () => undefined,
        exportKeyPackage: async () => fakeKeyPackage(),
        importKeyPackage: async () => undefined,
      },
      session: {
        registerIdentity: async () =>
          options.registerOk ? { challenge: "ch" } : null,
        login: async () => options.loginOk,
      },
      dispose: () => {
        events.push("sdk.dispose");
      },
    }) as unknown as Tearleads;

  await expect(
    MultiUserDevice.register(
      "http://127.0.0.1:4001",
      "http://127.0.0.1:4000",
      "alice",
      {
        openLocalDatabase: async () => fakeLocalDb(events),
        createSdkHost: () => makeSdk({ registerOk: false, loginOk: false }),
      },
    ),
  ).rejects.toThrow("alice could not register.");
  expect(events).toEqual(["sdk.dispose", "db.close"]);

  events.length = 0;
  await expect(
    MultiUserDevice.login(
      "http://127.0.0.1:4001",
      "http://127.0.0.1:4000",
      "bob",
      fakeKeyPackage(),
      {
        openLocalDatabase: async () => fakeLocalDb(events),
        createSdkHost: () => makeSdk({ registerOk: true, loginOk: false }),
      },
    ),
  ).rejects.toThrow("bob could not log in.");
  expect(events).toEqual(["sdk.dispose", "db.close"]);
});

test("readDocumentUntilText converges across retries, matches immediately, and throws when missing", async () => {
  const events: string[] = [];
  let syncAttempts = 0;
  let docPresent = true;
  let currentText = "initial";

  const makeDevice = () =>
    MultiUserDevice.login(
      "http://127.0.0.1:4001",
      "http://127.0.0.1:4000",
      "alice",
      fakeKeyPackage(),
      {
        openLocalDatabase: async () => fakeLocalDb(events),
        createSdkHost: () =>
          ({
            identity: {
              importKeyPackage: async () => undefined,
            },
            session: {
              login: async () => true,
            },
            containerContents: {
              openTree: () => ({
                updateRuntime: () => undefined,
                getSnapshot: () => ({ ready: true, nodes: [] }),
                refresh: async () => true,
              }),
              workflowRuntime: () => ({}),
              discoverContainerDocuments: async () => [],
            },
            documents: {
              findLocalIdByDocumentId: async () =>
                docPresent ? "local-1" : null,
              list: async () => ({
                rows: docPresent ? [{ id: "local-1", containerId: "c-1" }] : [],
              }),
              open: () => ({
                getSnapshot: () => ({ text: currentText }),
                requestRemoteSyncAndWait: async () => {
                  syncAttempts += 1;
                  if (syncAttempts >= 2) currentText = "converged";
                  return true;
                },
              }),
            },
            dispose: () => undefined,
          }) as unknown as Tearleads,
      },
    );

  const device = await makeDevice();
  try {
    // Immediate match without extra retry loop.
    const immediate = await device.readDocumentUntilText(
      "doc-1",
      ["c-1"],
      "initial",
    );
    expect(immediate.getSnapshot().text).toBe("initial");
    expect(syncAttempts).toBe(1);

    // Retries remote sync until target text arrives.
    const converged = await device.readDocumentUntilText(
      "doc-1",
      ["c-1"],
      "converged",
    );
    expect(converged.getSnapshot().text).toBe("converged");
    expect(syncAttempts).toBeGreaterThanOrEqual(2);

    // Throws cleanly when document cannot be found.
    docPresent = false;
    await expect(
      device.readDocumentUntilText("doc-missing", ["c-1"], "anything"),
    ).rejects.toThrow(/could not open document doc-missing/u);
  } finally {
    device.dispose();
  }
});
