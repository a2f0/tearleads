import { useCallback, useMemo, useState } from "react";
import type { IdentityContextValue } from "../../../providers/identity/IdentityProvider";

export interface IdentitySwitcherState {
  readonly activeIdentityId: string | null;
  readonly available: boolean;
  readonly busy: boolean;
  readonly createIdentity: () => Promise<void>;
  readonly error: string | null;
  readonly identities: IdentityContextValue["localIdentities"];
  readonly selectIdentity: (signingFingerprint: string) => Promise<void>;
}

export function useIdentitySwitcher(
  identity: IdentityContextValue,
  externalBusy = false,
): IdentitySwitcherState {
  const [error, setError] = useState<string | null>(null);

  const selectIdentity = useCallback(
    async (signingFingerprint: string) => {
      setError(null);
      const switched = await identity.switchIdentity(signingFingerprint);
      if (!switched) {
        setError("Could not switch identities.");
      }
    },
    [identity.switchIdentity],
  );
  const createIdentity = useCallback(async () => {
    setError(null);
    const created = await identity.createIdentity();
    if (!created) {
      setError("Could not create a new identity.");
    }
  }, [identity.createIdentity]);

  return useMemo(
    () => ({
      activeIdentityId: identity.signingFingerprint,
      available: identity.localIdentitySwitchingAvailable,
      busy: identity.identityTransitionInFlight || externalBusy,
      createIdentity,
      error,
      identities: identity.localIdentities,
      selectIdentity,
    }),
    [
      createIdentity,
      error,
      externalBusy,
      identity.identityTransitionInFlight,
      identity.localIdentities,
      identity.localIdentitySwitchingAvailable,
      identity.signingFingerprint,
      selectIdentity,
    ],
  );
}
