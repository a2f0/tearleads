import { type IdentityKeyPackage, Tearleads } from "@tearleads/client-sdk";
import { type MutableRefObject, useCallback } from "react";
import { prepareForIdentityTransition } from "./identityRuntimeTransition";
import type {
  LocalIdentityRepository,
  LocalIdentitySummary,
} from "./localIdentityRegistry";

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

interface IdentitySwitchDependencies {
  readonly clearDatabase: () => void;
  readonly ensureIdentityDatabaseReady: (
    signingFingerprint: string,
  ) => Promise<void>;
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly localPersistence: LocalIdentityRepository | null;
  readonly onIdentitiesChanged: (
    identities: readonly LocalIdentitySummary[],
  ) => void;
  readonly persistSessionBeforeIdentityTransition: () => Promise<void>;
  readonly setTransitionInFlight: (inFlight: boolean) => void;
  readonly tearleads: Tearleads;
  readonly transitionInFlightRef: MutableRefObject<boolean>;
}

interface IdentitySwitchOperation extends IdentitySwitchDependencies {
  readonly generationId: number;
  readonly signingFingerprint: string;
}

interface PreviousIdentity {
  readonly keyPackage: IdentityKeyPackage | null;
  readonly signingFingerprint: string | null;
}

function assertTransitionIsCurrent(input: IdentitySwitchOperation): void {
  if (input.generationIdRef.current !== input.generationId) {
    throw new Error("Identity switch was superseded.");
  }
}

async function loadPreviousIdentity(
  input: IdentitySwitchOperation,
): Promise<PreviousIdentity> {
  const previousSigningFingerprint =
    input.tearleads.identity.signingFingerprint;
  const previousKeyPackage = previousSigningFingerprint
    ? await input.tearleads.identity.exportKeyPackage()
    : null;
  assertTransitionIsCurrent(input);
  if (
    previousKeyPackage &&
    previousKeyPackage.signingFingerprint !== previousSigningFingerprint
  ) {
    throw new Error(
      "Current identity fingerprint does not match its key package.",
    );
  }

  return {
    keyPackage: previousKeyPackage,
    signingFingerprint: previousSigningFingerprint,
  };
}

async function clearPublishedIdentity(
  input: IdentitySwitchOperation,
): Promise<void> {
  await input.tearleads.identity.setKeyPairs({
    encapsulationKeyPair: null,
    signingKeyPair: null,
  });
  assertTransitionIsCurrent(input);
}

async function importExpectedIdentity(
  input: IdentitySwitchOperation,
  keyPackage: IdentityKeyPackage,
  expectedFingerprint: string,
): Promise<void> {
  const snapshot = await input.tearleads.identity.importKeyPackage(keyPackage);
  assertTransitionIsCurrent(input);
  if (snapshot.signingFingerprint !== expectedFingerprint) {
    throw new Error("Identity fingerprint does not match its key package.");
  }
}

async function activateTargetIdentity(
  input: IdentitySwitchOperation,
  target: IdentityKeyPackage,
  commitTarget: () => Promise<readonly LocalIdentitySummary[]>,
  afterTargetReady?: (() => Promise<void>) | undefined,
): Promise<void> {
  // Dispose while the old fingerprint is still published so its domain
  // coordinator cannot survive the transition. Publishing null immediately
  // also invalidates any authentication request that began under that identity.
  prepareForIdentityTransition(input.tearleads);
  input.clearDatabase();
  await clearPublishedIdentity(input);
  await importExpectedIdentity(input, target, input.signingFingerprint);
  await input.ensureIdentityDatabaseReady(input.signingFingerprint);
  assertTransitionIsCurrent(input);
  await afterTargetReady?.();
  assertTransitionIsCurrent(input);

  // The registry is the durable commit point. Do not select the target for the
  // next boot until its runtime has started successfully.
  const identities = await commitTarget();
  assertTransitionIsCurrent(input);
  input.onIdentitiesChanged(identities);
}

async function restorePreviousIdentity(
  input: IdentitySwitchOperation,
  previous: PreviousIdentity,
  previousSession: Tearleads["session"]["snapshot"],
): Promise<void> {
  prepareForIdentityTransition(input.tearleads);
  input.clearDatabase();
  await clearPublishedIdentity(input);
  if (!previous.keyPackage || !previous.signingFingerprint) {
    return;
  }

  await importExpectedIdentity(
    input,
    previous.keyPackage,
    previous.signingFingerprint,
  );
  await input.ensureIdentityDatabaseReady(previous.signingFingerprint);
  assertTransitionIsCurrent(input);
  if (input.localPersistence) {
    const identities = await input.localPersistence.setActive(
      previous.signingFingerprint,
    );
    assertTransitionIsCurrent(input);
    input.onIdentitiesChanged(identities);
  }
  input.tearleads.session.setContext(previousSession);
}

async function transitionLocalIdentity(
  input: IdentitySwitchOperation,
  target: IdentityKeyPackage,
  commitTarget: () => Promise<readonly LocalIdentitySummary[]>,
  afterTargetReady?: (() => Promise<void>) | undefined,
): Promise<boolean> {
  let previous: PreviousIdentity;
  try {
    previous = await loadPreviousIdentity(input);
    await input.persistSessionBeforeIdentityTransition();
    assertTransitionIsCurrent(input);
  } catch (error: unknown) {
    input.tearleads.logError("Failed to transition local identity", error);
    return false;
  }

  const previousSession = { ...input.tearleads.session.snapshot };
  try {
    await activateTargetIdentity(input, target, commitTarget, afterTargetReady);
    return true;
  } catch (error: unknown) {
    input.tearleads.logError("Failed to transition local identity", error);
  }

  if (input.generationIdRef.current === input.generationId) {
    try {
      await restorePreviousIdentity(input, previous, previousSession);
    } catch (error: unknown) {
      input.tearleads.logError(
        "Failed to restore the previous local identity",
        error,
      );
    }
  }
  return false;
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
  } catch (error: unknown) {
    input.tearleads.logError("Failed to switch local identity", error);
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
      try {
        return await switchLocalIdentity({
          ...input,
          generationId,
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
  const candidate = new Tearleads();
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
      try {
        const target = await validateIdentityKeyPackage(keyPackage);
        const operation: IdentitySwitchOperation = {
          ...input,
          generationId,
          signingFingerprint: target.signingFingerprint,
        };
        assertTransitionIsCurrent(operation);
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
