import type { IdentityKeyPackage, SymCrypt } from "@symcrypt/client-sdk";
import type { MutableRefObject } from "react";
import { prepareForIdentityTransition } from "./identityRuntimeTransition";
import {
  type IdentityTransitionKind,
  logIdentityTransitionPhase,
  logIdentityTransitionResult,
} from "./identityTransitionTrace";
import type {
  LocalIdentityRepository,
  LocalIdentitySummary,
} from "./localIdentityRegistry";

export interface IdentitySwitchDependencies {
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
  readonly symcrypt: SymCrypt;
  readonly transitionInFlightRef: MutableRefObject<boolean>;
}

export interface IdentitySwitchOperation extends IdentitySwitchDependencies {
  readonly generationId: number;
  readonly kind: IdentityTransitionKind;
  readonly signingFingerprint: string;
}

interface PreviousIdentity {
  readonly keyPackage: IdentityKeyPackage | null;
  readonly signingFingerprint: string | null;
}

export function assertTransitionIsCurrent(
  input: IdentitySwitchOperation,
): void {
  if (input.generationIdRef.current !== input.generationId) {
    throw new Error("Identity switch was superseded.");
  }
}

async function loadPreviousIdentity(
  input: IdentitySwitchOperation,
): Promise<PreviousIdentity> {
  const previousSigningFingerprint = input.symcrypt.identity.signingFingerprint;
  const previousKeyPackage = previousSigningFingerprint
    ? await input.symcrypt.identity.exportKeyPackage()
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
  await input.symcrypt.identity.setKeyPairs({
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
  const snapshot = await input.symcrypt.identity.importKeyPackage(keyPackage);
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
  prepareForIdentityTransition(input.symcrypt);
  input.clearDatabase();
  await clearPublishedIdentity(input);
  await importExpectedIdentity(input, target, input.signingFingerprint);
  logIdentityTransitionPhase(
    input.symcrypt,
    input.generationId,
    input.kind,
    "runtime-prepared",
  );
  logIdentityTransitionPhase(
    input.symcrypt,
    input.generationId,
    input.kind,
    "database-wait-started",
  );
  await input.ensureIdentityDatabaseReady(input.signingFingerprint);
  assertTransitionIsCurrent(input);
  logIdentityTransitionPhase(
    input.symcrypt,
    input.generationId,
    input.kind,
    "database-ready",
  );
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
  previousSession: SymCrypt["session"]["snapshot"],
): Promise<boolean> {
  prepareForIdentityTransition(input.symcrypt);
  input.clearDatabase();
  await clearPublishedIdentity(input);
  if (!previous.keyPackage || !previous.signingFingerprint) {
    return false;
  }

  await importExpectedIdentity(
    input,
    previous.keyPackage,
    previous.signingFingerprint,
  );
  await input.ensureIdentityDatabaseReady(previous.signingFingerprint);
  assertTransitionIsCurrent(input);
  logIdentityTransitionPhase(
    input.symcrypt,
    input.generationId,
    input.kind,
    "rollback-database-ready",
  );
  if (input.localPersistence) {
    const identities = await input.localPersistence.setActive(
      previous.signingFingerprint,
    );
    assertTransitionIsCurrent(input);
    input.onIdentitiesChanged(identities);
  }
  input.symcrypt.session.setContext(previousSession);
  return true;
}

export async function transitionLocalIdentity(
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
    logIdentityTransitionPhase(
      input.symcrypt,
      input.generationId,
      input.kind,
      "session-persisted",
    );
  } catch (error: unknown) {
    input.symcrypt.logError("Failed to transition local identity", error);
    logIdentityTransitionResult(
      input.symcrypt,
      input.generationId,
      input.kind,
      { rollback: "not-needed", status: "failed" },
    );
    return false;
  }

  const previousSession = { ...input.symcrypt.session.snapshot };
  try {
    await activateTargetIdentity(input, target, commitTarget, afterTargetReady);
    logIdentityTransitionResult(
      input.symcrypt,
      input.generationId,
      input.kind,
      { status: "succeeded" },
    );
    return true;
  } catch (error: unknown) {
    input.symcrypt.logError("Failed to transition local identity", error);
  }

  if (input.generationIdRef.current === input.generationId) {
    logIdentityTransitionPhase(
      input.symcrypt,
      input.generationId,
      input.kind,
      "rollback-started",
    );
    try {
      const restored = await restorePreviousIdentity(
        input,
        previous,
        previousSession,
      );
      logIdentityTransitionResult(
        input.symcrypt,
        input.generationId,
        input.kind,
        {
          rollback: restored ? "succeeded" : "unavailable",
          status: "failed",
        },
      );
    } catch (error: unknown) {
      input.symcrypt.logError(
        "Failed to restore the previous local identity",
        error,
      );
      logIdentityTransitionResult(
        input.symcrypt,
        input.generationId,
        input.kind,
        { rollback: "failed", status: "failed" },
      );
    }
  } else {
    logIdentityTransitionResult(
      input.symcrypt,
      input.generationId,
      input.kind,
      { rollback: "superseded", status: "failed" },
    );
  }
  return false;
}
