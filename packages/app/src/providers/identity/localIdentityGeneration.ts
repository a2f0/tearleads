import type { SymCrypt } from "@symcrypt/client-sdk";
import {
  createIdentitySeedPhrase,
  generateIdentityKeyPairsFromSeedPhrase,
  toFingerprint,
} from "@symcrypt/crypto";
import { type MutableRefObject, useCallback } from "react";
import { prepareForIdentityTransition } from "./identityRuntimeTransition";

export function useGenerateKey(input: {
  readonly ensureIdentityDatabaseReady: (
    signingFingerprint: string,
  ) => Promise<void>;
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly persistLocalIdentity: (
    shouldPersist?: () => boolean,
  ) => Promise<void>;
  readonly symcrypt: SymCrypt;
}): () => Promise<boolean> {
  const {
    ensureIdentityDatabaseReady,
    generationIdRef,
    generationInFlight,
    persistLocalIdentity,
    symcrypt,
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

      prepareForIdentityTransition(symcrypt);
      await symcrypt.identity.setKeyPairs({
        encapsulationKeyPair,
        seedPhrase,
        signingKeyPair,
      });
      await symcrypt.session.bootstrapLocalRootContainer();
      if (generationIdRef.current !== generationId) {
        return false;
      }

      await persistLocalIdentity(
        () => generationIdRef.current === generationId,
      );
      if (generationIdRef.current !== generationId) {
        return false;
      }

      return true;
    } catch (error) {
      if (generationIdRef.current !== generationId) {
        return false;
      }

      if (symcrypt.identity.signingKeyPair) {
        symcrypt.identity.destroy();
      }
      symcrypt.logError("Failed to generate identity keys", error);
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
    symcrypt,
  ]);
}
