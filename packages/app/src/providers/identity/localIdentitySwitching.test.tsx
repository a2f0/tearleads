import { expect, test } from "bun:test";
import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { renderHook } from "@testing-library/react";
import type { LocalIdentityRepository } from "./localIdentityRegistry";
import {
  useCreateLocalIdentity,
  useImportLocalIdentity,
  useSwitchLocalIdentity,
} from "./localIdentitySwitching";

function createQuietTearleads(logs: string[] = []): Tearleads {
  return new Tearleads({
    blobStore: createMemoryBlobStore(),
    logger: {
      log: (message) => logs.push(message),
      logError: () => undefined,
    },
  });
}

async function createKeyPackage() {
  const source = createQuietTearleads();
  await source.identity.setKeyPairs({
    encapsulationKeyPair: generateKemSeedAndKeyPair(),
    signingKeyPair: generateSigningSeedAndKeyPair(),
  });
  return await source.identity.exportKeyPackage();
}

test("failed identity creation returns to the previous identity", async () => {
  const identityA = await createKeyPackage();
  const tearleads = createQuietTearleads();
  await tearleads.identity.importKeyPackage(identityA);
  const identityASession = {
    authToken: "token-a",
    containerId: "container-a",
    defaultOrganizationId: "default-organization-a",
    isAuthenticated: true,
    organizationId: "organization-a",
    userId: "user-a",
  };
  tearleads.session.setContext(identityASession);
  const switchedFingerprints: string[] = [];
  const generationInFlight = { current: false };
  const transitionInFlightRef = { current: false };
  const view = renderHook(() =>
    useCreateLocalIdentity({
      clearDatabase: () => undefined,
      generateKey: async () => false,
      generationInFlight,
      persistSessionBeforeIdentityTransition: async () => undefined,
      setTransitionInFlight: () => undefined,
      switchIdentity: async (signingFingerprint) => {
        switchedFingerprints.push(signingFingerprint);
        await tearleads.identity.importKeyPackage(identityA);
        return true;
      },
      tearleads,
      transitionInFlightRef,
    }),
  );

  expect(await view.result.current()).toBe(false);
  expect(switchedFingerprints).toEqual([identityA.signingFingerprint]);
  expect(tearleads.identity.signingFingerprint).toBe(
    identityA.signingFingerprint,
  );
  expect(tearleads.session.snapshot).toEqual(identityASession);
  expect(generationInFlight.current).toBe(false);
  expect(transitionInFlightRef.current).toBe(false);
});

test("failed target startup rolls back the live identity, session, and active selection", async () => {
  const identityA = await createKeyPackage();
  const identityB = await createKeyPackage();
  const logs: string[] = [];
  const tearleads = createQuietTearleads(logs);
  await tearleads.identity.importKeyPackage(identityA);
  tearleads.session.setContext({
    authToken: "token-a",
    containerId: "container-a",
    defaultOrganizationId: "default-organization-a",
    isAuthenticated: true,
    organizationId: "organization-a",
    userId: "user-a",
  });

  const activeSelections: string[] = [];
  const repository = {
    findKeyPackage: async (signingFingerprint: string) =>
      signingFingerprint === identityB.signingFingerprint ? identityB : null,
    setActive: async (signingFingerprint: string) => {
      activeSelections.push(signingFingerprint);
      return [];
    },
  } as unknown as LocalIdentityRepository;
  const ensuredFingerprints: string[] = [];
  const disposedFingerprints: Array<string | null> = [];
  const originalDispose = tearleads.dispose.bind(tearleads);
  tearleads.dispose = () => {
    disposedFingerprints.push(tearleads.identity.signingFingerprint);
    originalDispose();
  };
  let databaseClearCount = 0;
  const generationIdRef = { current: 0 };
  const generationInFlight = { current: false };
  const transitionInFlightRef = { current: false };
  const view = renderHook(() =>
    useSwitchLocalIdentity({
      clearDatabase: () => {
        databaseClearCount += 1;
      },
      ensureIdentityDatabaseReady: async (signingFingerprint) => {
        ensuredFingerprints.push(signingFingerprint);
        if (signingFingerprint === identityB.signingFingerprint) {
          throw new Error("target database failed");
        }
      },
      generationIdRef,
      generationInFlight,
      localPersistence: repository,
      onIdentitiesChanged: () => undefined,
      persistSessionBeforeIdentityTransition: async () => undefined,
      setTransitionInFlight: () => undefined,
      tearleads,
      transitionInFlightRef,
    }),
  );

  expect(await view.result.current(identityB.signingFingerprint)).toBe(false);

  expect(tearleads.identity.signingFingerprint).toBe(
    identityA.signingFingerprint,
  );
  expect(tearleads.session.snapshot).toEqual({
    authToken: "token-a",
    containerId: "container-a",
    defaultOrganizationId: "default-organization-a",
    isAuthenticated: true,
    organizationId: "organization-a",
    userId: "user-a",
  });
  expect(ensuredFingerprints).toEqual([
    identityB.signingFingerprint,
    identityA.signingFingerprint,
  ]);
  expect(activeSelections).toEqual([identityA.signingFingerprint]);
  expect(disposedFingerprints).toEqual([
    identityA.signingFingerprint,
    identityB.signingFingerprint,
  ]);
  expect(databaseClearCount).toBe(2);
  expect(generationInFlight.current).toBe(false);
  expect(transitionInFlightRef.current).toBe(false);
  expect(
    logs.filter((message) => message.startsWith("identity transition")),
  ).toEqual([
    "identity transition generation=1 kind=switch phase=started",
    "identity transition generation=1 kind=switch phase=target-loaded",
    "identity transition generation=1 kind=switch phase=session-persisted",
    "identity transition generation=1 kind=switch phase=runtime-prepared",
    "identity transition generation=1 kind=switch phase=database-wait-started",
    "identity transition generation=1 kind=switch phase=rollback-started",
    "identity transition generation=1 kind=switch phase=rollback-database-ready",
    "identity transition generation=1 kind=switch result=failed rollback=succeeded",
  ]);
});

test("failed key-package import startup leaves the restored identity uncommitted", async () => {
  const identityA = await createKeyPackage();
  const identityB = await createKeyPackage();
  const tearleads = createQuietTearleads();
  await tearleads.identity.importKeyPackage(identityA);
  const identityASession = {
    authToken: "token-a",
    containerId: "container-a",
    defaultOrganizationId: "default-organization-a",
    isAuthenticated: true,
    organizationId: "organization-a",
    userId: "user-a",
  };
  tearleads.session.setContext(identityASession);
  const activeSelections: string[] = [];
  let importedIdentityCommitCount = 0;
  const repository = {
    setActive: async (signingFingerprint: string) => {
      activeSelections.push(signingFingerprint);
      return [];
    },
    upsert: async () => {
      importedIdentityCommitCount += 1;
      return [];
    },
  } as unknown as LocalIdentityRepository;
  const generationIdRef = { current: 0 };
  const generationInFlight = { current: false };
  const transitionInFlightRef = { current: false };
  const view = renderHook(() =>
    useImportLocalIdentity({
      clearDatabase: () => undefined,
      ensureIdentityDatabaseReady: async (signingFingerprint) => {
        if (signingFingerprint === identityB.signingFingerprint) {
          throw new Error("target database failed");
        }
      },
      generationIdRef,
      generationInFlight,
      localPersistence: repository,
      onIdentitiesChanged: () => undefined,
      persistSessionBeforeIdentityTransition: async () => undefined,
      setTransitionInFlight: () => undefined,
      tearleads,
      transitionInFlightRef,
    }),
  );

  expect(await view.result.current(identityB)).toBe(false);
  expect(tearleads.identity.signingFingerprint).toBe(
    identityA.signingFingerprint,
  );
  expect(tearleads.session.snapshot).toEqual(identityASession);
  expect(importedIdentityCommitCount).toBe(0);
  expect(activeSelections).toEqual([identityA.signingFingerprint]);
});

test("key-package import commits only after database readiness and bootstrap", async () => {
  const identityA = await createKeyPackage();
  const identityB = await createKeyPackage();
  const tearleads = createQuietTearleads();
  await tearleads.identity.importKeyPackage(identityA);
  const operationOrder: string[] = [];
  Reflect.set(tearleads.session, "bootstrapLocalRootContainer", async () => {
    operationOrder.push("bootstrap");
    return { containerId: "root-b", created: true };
  });
  const repository = {
    setActive: async () => [],
    upsert: async () => {
      operationOrder.push("commit");
      return [];
    },
  } as unknown as LocalIdentityRepository;
  const view = renderHook(() =>
    useImportLocalIdentity({
      clearDatabase: () => undefined,
      ensureIdentityDatabaseReady: async () => {
        operationOrder.push("ready");
      },
      generationIdRef: { current: 0 },
      generationInFlight: { current: false },
      localPersistence: repository,
      onIdentitiesChanged: () => undefined,
      persistSessionBeforeIdentityTransition: async () => undefined,
      setTransitionInFlight: () => undefined,
      tearleads,
      transitionInFlightRef: { current: false },
    }),
  );

  expect(await view.result.current(identityB)).toBe(true);
  expect(tearleads.identity.signingFingerprint).toBe(
    identityB.signingFingerprint,
  );
  expect(operationOrder).toEqual(["ready", "bootstrap", "commit"]);
});

test("active selection is committed only after the target database is ready", async () => {
  const identityA = await createKeyPackage();
  const identityB = await createKeyPackage();
  const logs: string[] = [];
  const tearleads = createQuietTearleads(logs);
  await tearleads.identity.importKeyPackage(identityA);
  const operationOrder: string[] = [];
  const repository = {
    findKeyPackage: async () => identityB,
    setActive: async (signingFingerprint: string) => {
      operationOrder.push(`active:${signingFingerprint}`);
      return [];
    },
  } as unknown as LocalIdentityRepository;
  const view = renderHook(() =>
    useSwitchLocalIdentity({
      clearDatabase: () => undefined,
      ensureIdentityDatabaseReady: async (signingFingerprint) => {
        operationOrder.push(`ready:${signingFingerprint}`);
      },
      generationIdRef: { current: 0 },
      generationInFlight: { current: false },
      localPersistence: repository,
      onIdentitiesChanged: () => undefined,
      persistSessionBeforeIdentityTransition: async () => undefined,
      setTransitionInFlight: () => undefined,
      tearleads,
      transitionInFlightRef: { current: false },
    }),
  );

  expect(await view.result.current(identityB.signingFingerprint)).toBe(true);
  expect(operationOrder).toEqual([
    `ready:${identityB.signingFingerprint}`,
    `active:${identityB.signingFingerprint}`,
  ]);
  expect(
    logs.filter((message) => message.startsWith("identity transition")),
  ).toEqual([
    "identity transition generation=1 kind=switch phase=started",
    "identity transition generation=1 kind=switch phase=target-loaded",
    "identity transition generation=1 kind=switch phase=session-persisted",
    "identity transition generation=1 kind=switch phase=runtime-prepared",
    "identity transition generation=1 kind=switch phase=database-wait-started",
    "identity transition generation=1 kind=switch phase=database-ready",
    "identity transition generation=1 kind=switch result=succeeded",
  ]);
});
