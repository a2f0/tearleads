import { purgeOpfsBlobStore, type Tearleads } from "@tearleads/client-sdk";
import { type MutableRefObject, useCallback, useState } from "react";
import { prepareForIdentityTransition } from "./identityRuntimeTransition";
import type {
  LocalIdentityRepository,
  LocalIdentitySummary,
} from "./localIdentityRegistry";

export function useDestroyKey(input: {
  readonly generationIdRef: MutableRefObject<number>;
  readonly generationInFlight: MutableRefObject<boolean>;
  readonly localPersistence: LocalIdentityRepository | null;
  readonly onIdentitiesChanged: (
    identities: readonly LocalIdentitySummary[],
  ) => void;
  readonly onIdentityRemoved: (signingFingerprint: string) => void;
  readonly purgeIdentityDatabase: (signingFingerprint: string) => Promise<void>;
  readonly setTransitionInFlight: (inFlight: boolean) => void;
  readonly tearleads: Tearleads;
  readonly transitionInFlightRef: MutableRefObject<boolean>;
}) {
  const {
    generationIdRef,
    generationInFlight,
    localPersistence,
    onIdentitiesChanged,
    onIdentityRemoved,
    purgeIdentityDatabase,
    setTransitionInFlight,
    tearleads,
    transitionInFlightRef,
  } = input;
  const [identityDestroyed, setIdentityDestroyed] = useState(false);

  const destroyKey = useCallback(
    async (signingFingerprint: string): Promise<boolean> => {
      if (generationInFlight.current || transitionInFlightRef.current) {
        return false;
      }
      const generationId = generationIdRef.current + 1;
      generationIdRef.current = generationId;
      generationInFlight.current = true;
      transitionInFlightRef.current = true;
      setTransitionInFlight(true);
      try {
        if (tearleads.identity.signingFingerprint === signingFingerprint) {
          setIdentityDestroyed(true);
          prepareForIdentityTransition(tearleads);
          tearleads.identity.destroy();
        }
        // Keep saved keys until all data is gone. After a partial failure, reload
        // restores the saved identity; it does not resume deletion. Dialog retries
        // use the captured fingerprint rather than the now-keyless SDK.
        await purgeIdentityDatabase(signingFingerprint);
        await purgeOpfsBlobStore(signingFingerprint);
        onIdentityRemoved(signingFingerprint);
        const identities = await localPersistence?.remove(signingFingerprint);
        if (identities) {
          onIdentitiesChanged(identities);
        }
        return true;
      } catch (error: unknown) {
        tearleads.logError("Failed to destroy local identity data", error);
        throw error;
      } finally {
        if (generationIdRef.current === generationId) {
          generationInFlight.current = false;
        }
        transitionInFlightRef.current = false;
        setTransitionInFlight(false);
      }
    },
    [
      generationIdRef,
      generationInFlight,
      localPersistence,
      onIdentitiesChanged,
      onIdentityRemoved,
      purgeIdentityDatabase,
      setTransitionInFlight,
      tearleads,
      transitionInFlightRef,
    ],
  );

  return { destroyKey, identityDestroyed };
}
