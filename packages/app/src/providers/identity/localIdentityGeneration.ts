import type { Tearleads } from "@tearleads/client-sdk";
import {
  createIdentitySeedPhrase,
  generateIdentityKeyPairsFromSeedPhrase,
  toFingerprint,
} from "@tearleads/crypto";
import { type MutableRefObject, useCallback } from "react";

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
      const seedPhrase = createIdentitySeedPhrase();
      const { encapsulationKeyPair, signingKeyPair } =
        generateIdentityKeyPairsFromSeedPhrase(seedPhrase);
      const signingFingerprint = await toFingerprint(
        signingKeyPair.signingPublicKey,
      );
      await ensureIdentityDatabaseReady(signingFingerprint);
      if (generationIdRef.current !== generationId) {
        return false;
      }

      await tearleads.identity.setKeyPairs({
        encapsulationKeyPair,
        seedPhrase,
        signingKeyPair,
      });
      await tearleads.session.bootstrapLocalRootContainer();
      if (generationIdRef.current !== generationId) {
        return false;
      }

      generationInFlight.current = false;
      void persistLocalIdentity(
        () => generationIdRef.current === generationId,
      ).catch((error: unknown) => {
        tearleads.logError(
          "Failed to persist local identity key package",
          error,
        );
      });

      return true;
    } catch (error) {
      if (generationIdRef.current !== generationId) {
        return false;
      }

      generationInFlight.current = false;
      if (tearleads.identity.signingKeyPair) {
        tearleads.identity.destroy();
      }
      tearleads.logError("Failed to generate identity keys", error);
      return false;
    }
  }, [
    ensureIdentityDatabaseReady,
    generationIdRef,
    generationInFlight,
    persistLocalIdentity,
    tearleads,
  ]);
}
