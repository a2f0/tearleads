import type { Tearleads } from "@tearleads/client-sdk";
import {
  generateIdentityKeyPairsFromSeedPhrase,
  toFingerprint,
} from "@tearleads/crypto";
import { type MutableRefObject, useCallback } from "react";

export function useRestoreSeedPhrase(input: {
  readonly ensureIdentityDatabaseReady: (
    signingFingerprint: string,
  ) => Promise<void>;
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly persistLocalIdentity: (
    shouldPersist?: () => boolean,
  ) => Promise<void>;
  readonly tearleads: Tearleads;
}): (seedPhrase: string) => Promise<void> {
  const {
    ensureIdentityDatabaseReady,
    generationIdRef,
    generationInFlight,
    persistLocalIdentity,
    tearleads,
  } = input;

  return useCallback(
    async (seedPhrase: string) => {
      if (generationInFlight.current) {
        throw new Error("Identity generation is already in flight.");
      }

      const generationId = generationIdRef.current + 1;
      generationIdRef.current = generationId;
      generationInFlight.current = true;

      try {
        const derived = generateIdentityKeyPairsFromSeedPhrase(seedPhrase);
        const signingFingerprint = await toFingerprint(
          derived.signingKeyPair.signingPublicKey,
        );
        await ensureIdentityDatabaseReady(signingFingerprint);
        if (generationIdRef.current !== generationId) {
          return;
        }

        await tearleads.identity.setKeyPairs({
          encapsulationKeyPair: derived.encapsulationKeyPair,
          seedPhrase: derived.seedPhrase,
          signingFingerprint,
          signingKeyPair: derived.signingKeyPair,
        });
        await tearleads.session.bootstrapLocalRootContainer();
        if (generationIdRef.current !== generationId) {
          return;
        }

        try {
          await persistLocalIdentity(
            () => generationIdRef.current === generationId,
          );
        } catch (error: unknown) {
          tearleads.logError(
            "Failed to persist local identity key package after seed phrase restore",
            error,
          );
        }
      } finally {
        if (generationIdRef.current === generationId) {
          generationInFlight.current = false;
        }
      }
    },
    [
      ensureIdentityDatabaseReady,
      generationIdRef,
      generationInFlight,
      persistLocalIdentity,
      tearleads,
    ],
  );
}
