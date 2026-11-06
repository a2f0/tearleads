import type { Tearleads } from "@tearleads/client-sdk";
import {
  createIdentitySeedPhrase,
  generateIdentityKeyPairsFromSeedPhrase,
  toFingerprint,
} from "@tearleads/crypto";
import { type MutableRefObject, useCallback } from "react";
import { prepareForIdentityTransition } from "./identityRuntimeTransition";

/** Generates and installs new identity keys; false once superseded. */
async function installGeneratedIdentity(
  input: {
    readonly ensureIdentityDatabaseReady: (
      signingFingerprint: string,
    ) => Promise<void>;
    readonly persistLocalIdentity: (
      shouldPersist?: () => boolean,
    ) => Promise<void>;
    readonly tearleads: Tearleads;
  },
  isCurrent: () => boolean,
): Promise<boolean> {
  const { tearleads } = input;
  const seedPhrase = createIdentitySeedPhrase();
  const { encapsulationKeyPair, signingKeyPair } =
    generateIdentityKeyPairsFromSeedPhrase(seedPhrase);
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  await input.ensureIdentityDatabaseReady(signingFingerprint);
  if (!isCurrent()) {
    return false;
  }

  prepareForIdentityTransition(tearleads);
  await tearleads.identity.setKeyPairs({
    encapsulationKeyPair,
    seedPhrase,
    signingKeyPair,
  });
  await tearleads.session.bootstrapLocalRootContainer();
  if (!isCurrent()) {
    return false;
  }

  await input.persistLocalIdentity(isCurrent);
  return isCurrent();
}

export function useGenerateKey(input: {
  readonly ensureIdentityDatabaseReady: (
    signingFingerprint: string,
  ) => Promise<void>;
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly persistLocalIdentity: (
    shouldPersist?: () => boolean,
  ) => Promise<void>;
  readonly tearleads: Tearleads;
}): () => Promise<boolean> {
  const {
    ensureIdentityDatabaseReady,
    generationIdRef,
    generationInFlight,
    persistLocalIdentity,
    tearleads,
  } = input;

  return useCallback(async () => {
    if (generationInFlight.current) {
      return false;
    }

    const generationId = generationIdRef.current + 1;
    generationIdRef.current = generationId;
    generationInFlight.current = true;

    try {
      return await installGeneratedIdentity(
        { ensureIdentityDatabaseReady, persistLocalIdentity, tearleads },
        () => generationIdRef.current === generationId,
      );
    } catch (error) {
      if (generationIdRef.current !== generationId) {
        return false;
      }

      if (tearleads.identity.signingKeyPair) {
        tearleads.identity.destroy();
      }
      tearleads.logError("Failed to generate identity keys", error);
      return false;
    } finally {
      if (generationIdRef.current === generationId) {
        generationInFlight.current = false;
      }
    }
  }, [
    ensureIdentityDatabaseReady,
    generationIdRef,
    generationInFlight,
    persistLocalIdentity,
    tearleads,
  ]);
}
