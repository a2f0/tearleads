import {
  createMemoryBlobStore,
  type IdentityKeyPackage,
  Tearleads,
} from "@tearleads/client-sdk";
import { type MutableRefObject, useCallback } from "react";
import { prepareForIdentityTransition } from "./identityRuntimeTransition";
import {
  logIdentityTransitionPhase,
  logIdentityTransitionResult,
} from "./identityTransitionTrace";
import type { LocalIdentityRepository } from "./localIdentityRegistry";
import {
  assertTransitionIsCurrent,
  type IdentitySwitchDependencies,
  type IdentitySwitchOperation,
  transitionLocalIdentity,
} from "./localIdentityTransition";

export function useCreateLocalIdentity(input: {
  readonly clearDatabase: () => void;
  readonly generateKey: () => Promise<boolean>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly persistSessionBeforeIdentityTransition: () => Promise<void>;
  readonly setTransitionInFlight: (inFlight: boolean) => void;
  readonly switchIdentity: (signingFingerprint: string) => Promise<boolean>;
  readonly tearleads: Tearleads;
  readonly transitionInFlightRef: MutableRefObject<boolean>;
}): () => Promise<boolean> {
  const {
    clearDatabase,
    generateKey,
    generationInFlight,
    persistSessionBeforeIdentityTransition,
    setTransitionInFlight,
    switchIdentity,
    tearleads,
    transitionInFlightRef,
  } = input;

  return useCallback(async () => {
    if (generationInFlight.current || transitionInFlightRef.current) {
      return false;
    }

    const previousSigningFingerprint = tearleads.identity.signingFingerprint;
    let previousSession = { ...tearleads.session.snapshot };
    let created = false;
    transitionInFlightRef.current = true;
    setTransitionInFlight(true);
    generationInFlight.current = true;
    try {
      await persistSessionBeforeIdentityTransition();
      previousSession = { ...tearleads.session.snapshot };
      prepareForIdentityTransition(tearleads);
      await tearleads.identity.setKeyPairs({
        encapsulationKeyPair: null,
        signingKeyPair: null,
      });
      clearDatabase();
      generationInFlight.current = false;
      created = await generateKey();
    } catch (error: unknown) {
      tearleads.logError("Failed to create a local identity", error);
    } finally {
      generationInFlight.current = false;
      transitionInFlightRef.current = false;
      setTransitionInFlight(false);
    }

    if (!created && previousSigningFingerprint) {
      const restored = await switchIdentity(previousSigningFingerprint);
      if (restored) {
        tearleads.session.setContext(previousSession);
      }
    }
    return created;
  }, [
    clearDatabase,
    generateKey,
    generationInFlight,
    persistSessionBeforeIdentityTransition,
    setTransitionInFlight,
    switchIdentity,
    tearleads,
    transitionInFlightRef,
  ]);
}

async function switchLocalIdentity(
  input: IdentitySwitchOperation & {
    readonly localPersistence: LocalIdentityRepository;
  },
): Promise<boolean> {
  let target: IdentityKeyPackage | null;
  try {
    target = await input.localPersistence.findKeyPackage(
      input.signingFingerprint,
    );
    assertTransitionIsCurrent(input);
    if (!target) {
      throw new Error("Selected local identity was not found.");
    }
    logIdentityTransitionPhase(
      input.tearleads,
      input.generationId,
      input.kind,
      "target-loaded",
    );
  } catch (error: unknown) {
    input.tearleads.logError("Failed to switch local identity", error);
    logIdentityTransitionResult(
      input.tearleads,
      input.generationId,
      input.kind,
      { rollback: "not-needed", status: "failed" },
    );
    return false;
  }

  const switched = await transitionLocalIdentity(input, target, () =>
    input.localPersistence.setActive(input.signingFingerprint),
  );
  if (switched) {
    input.tearleads.log(`Switched local identity: ${input.signingFingerprint}`);
  }
  return switched;
}

export function useSwitchLocalIdentity(
  input: IdentitySwitchDependencies,
): (signingFingerprint: string) => Promise<boolean> {
  const {
    clearDatabase,
    ensureIdentityDatabaseReady,
    generationIdRef,
    generationInFlight,
    localPersistence,
    onIdentitiesChanged,
    setTransitionInFlight,
    tearleads,
    transitionInFlightRef,
  } = input;

  return useCallback(
    async (signingFingerprint: string) => {
      if (tearleads.identity.signingFingerprint === signingFingerprint) {
        return true;
      }
      if (
        !localPersistence ||
        generationInFlight.current ||
        transitionInFlightRef.current
      ) {
        return false;
      }

      transitionInFlightRef.current = true;
      setTransitionInFlight(true);
      const generationId = generationIdRef.current + 1;
      generationIdRef.current = generationId;
      generationInFlight.current = true;
      logIdentityTransitionPhase(tearleads, generationId, "switch", "started");
      try {
        return await switchLocalIdentity({
          ...input,
          generationId,
          kind: "switch",
          localPersistence,
          signingFingerprint,
        });
      } finally {
        if (generationIdRef.current === generationId) {
          generationInFlight.current = false;
        }
        transitionInFlightRef.current = false;
        setTransitionInFlight(false);
      }
    },
    [
      clearDatabase,
      ensureIdentityDatabaseReady,
      generationIdRef,
      generationInFlight,
      input.persistSessionBeforeIdentityTransition,
      localPersistence,
      onIdentitiesChanged,
      setTransitionInFlight,
      tearleads,
      transitionInFlightRef,
    ],
  );
}

async function validateIdentityKeyPackage(
  keyPackage: unknown,
): Promise<IdentityKeyPackage> {
  const candidate = new Tearleads({ blobStore: createMemoryBlobStore() });
  try {
    await candidate.identity.importKeyPackage(keyPackage);
    return await candidate.identity.exportKeyPackage();
  } finally {
    candidate.dispose();
  }
}

export function useImportLocalIdentity(
  input: IdentitySwitchDependencies,
): (keyPackage: unknown) => Promise<boolean> {
  const {
    clearDatabase,
    ensureIdentityDatabaseReady,
    generationIdRef,
    generationInFlight,
    localPersistence,
    onIdentitiesChanged,
    setTransitionInFlight,
    tearleads,
    transitionInFlightRef,
  } = input;

  return useCallback(
    async (keyPackage: unknown) => {
      if (generationInFlight.current || transitionInFlightRef.current) {
        return false;
      }

      transitionInFlightRef.current = true;
      setTransitionInFlight(true);
      const generationId = generationIdRef.current + 1;
      generationIdRef.current = generationId;
      generationInFlight.current = true;
      logIdentityTransitionPhase(tearleads, generationId, "import", "started");
      try {
        const target = await validateIdentityKeyPackage(keyPackage);
        const operation: IdentitySwitchOperation = {
          ...input,
          generationId,
          kind: "import",
          signingFingerprint: target.signingFingerprint,
        };
        assertTransitionIsCurrent(operation);
        logIdentityTransitionPhase(
          tearleads,
          generationId,
          "import",
          "target-loaded",
        );
        const imported = await transitionLocalIdentity(
          operation,
          target,
          () =>
            localPersistence
              ? localPersistence.upsert(target)
              : Promise.resolve([]),
          async () => {
            await tearleads.session.bootstrapLocalRootContainer();
          },
        );
        if (imported) {
          tearleads.log(
            `Imported local identity: ${target.signingFingerprint}`,
          );
        }
        return imported;
      } catch (error: unknown) {
        tearleads.logError("Failed to import local identity", error);
        logIdentityTransitionResult(tearleads, generationId, "import", {
          rollback: "not-needed",
          status: "failed",
        });
        return false;
      } finally {
        if (generationIdRef.current === generationId) {
          generationInFlight.current = false;
        }
        transitionInFlightRef.current = false;
        setTransitionInFlight(false);
      }
    },
    [
      clearDatabase,
      ensureIdentityDatabaseReady,
      generationIdRef,
      generationInFlight,
      input.persistSessionBeforeIdentityTransition,
      localPersistence,
      onIdentitiesChanged,
      setTransitionInFlight,
      tearleads,
      transitionInFlightRef,
    ],
  );
}
