import {
  createMemoryBlobStore,
  type IdentityKeyPackage,
  SymCrypt,
} from "@symcrypt/client-sdk";
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
  readonly symcrypt: SymCrypt;
  readonly transitionInFlightRef: MutableRefObject<boolean>;
}): () => Promise<boolean> {
  const {
    clearDatabase,
    generateKey,
    generationInFlight,
    persistSessionBeforeIdentityTransition,
    setTransitionInFlight,
    switchIdentity,
    symcrypt,
    transitionInFlightRef,
  } = input;

  return useCallback(async () => {
    if (generationInFlight.current || transitionInFlightRef.current) {
      return false;
    }

    const previousSigningFingerprint = symcrypt.identity.signingFingerprint;
    let previousSession = { ...symcrypt.session.snapshot };
    let created = false;
    transitionInFlightRef.current = true;
    setTransitionInFlight(true);
    generationInFlight.current = true;
    try {
      await persistSessionBeforeIdentityTransition();
      previousSession = { ...symcrypt.session.snapshot };
      prepareForIdentityTransition(symcrypt);
      await symcrypt.identity.setKeyPairs({
        encapsulationKeyPair: null,
        signingKeyPair: null,
      });
      clearDatabase();
      generationInFlight.current = false;
      created = await generateKey();
    } catch (error: unknown) {
      symcrypt.logError("Failed to create a local identity", error);
    } finally {
      generationInFlight.current = false;
      transitionInFlightRef.current = false;
      setTransitionInFlight(false);
    }

    if (!created && previousSigningFingerprint) {
      const restored = await switchIdentity(previousSigningFingerprint);
      if (restored) {
        symcrypt.session.setContext(previousSession);
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
    symcrypt,
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
      input.symcrypt,
      input.generationId,
      input.kind,
      "target-loaded",
    );
  } catch (error: unknown) {
    input.symcrypt.logError("Failed to switch local identity", error);
    logIdentityTransitionResult(
      input.symcrypt,
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
    input.symcrypt.log(`Switched local identity: ${input.signingFingerprint}`);
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
    symcrypt,
    transitionInFlightRef,
  } = input;

  return useCallback(
    async (signingFingerprint: string) => {
      if (symcrypt.identity.signingFingerprint === signingFingerprint) {
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
      logIdentityTransitionPhase(symcrypt, generationId, "switch", "started");
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
      symcrypt,
      transitionInFlightRef,
    ],
  );
}

async function validateIdentityKeyPackage(
  keyPackage: unknown,
): Promise<IdentityKeyPackage> {
  const candidate = new SymCrypt({ blobStore: createMemoryBlobStore() });
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
    symcrypt,
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
      logIdentityTransitionPhase(symcrypt, generationId, "import", "started");
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
          symcrypt,
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
            await symcrypt.session.bootstrapLocalRootContainer();
          },
        );
        if (imported) {
          symcrypt.log(`Imported local identity: ${target.signingFingerprint}`);
        }
        return imported;
      } catch (error: unknown) {
        symcrypt.logError("Failed to import local identity", error);
        logIdentityTransitionResult(symcrypt, generationId, "import", {
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
      symcrypt,
      transitionInFlightRef,
    ],
  );
}
