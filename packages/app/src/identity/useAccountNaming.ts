import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import {
  type AccountNamingPersistence,
  claimAccountNamingWrite,
  loadPersistedAccountNaming,
  removePersistedAccountNaming,
  savePersistedAccountNaming,
  useAccountNamingPersistence,
} from "../providers/identity/accountNamingPersistence";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../providers/local-keyring/LocalKeyringLockProvider";
import { useLog } from "../providers/logging/LogProvider";
import {
  ACCOUNT_NAMING_IDLE,
  type AccountNamingEvent,
  type AccountNamingState,
  accountNamingFor,
  sealedAccountNaming,
  transitionAccountNaming,
} from "./accountNamingMachine";

export interface AccountNaming {
  /** The naming state of the current identity. */
  readonly state: AccountNamingState;
  /**
   * Whether the current identity's sealed naming has been read back, so
   * registration cannot run ahead of a name given before a restart.
   */
  readonly settled: boolean;
  readonly contactNamed: (fingerprint: string) => void;
  readonly identityNamed: (fingerprint: string, name: string) => void;
  readonly submit: (name: string) => void;
}

/**
 * Reads the current identity's sealed naming back once per identity. A read
 * that fails is not taken as no record: see the machine's `unreadable`.
 */
function useRestoredAccountNaming(
  persistence: AccountNamingPersistence | null,
  signingFingerprint: string | null,
  dispatch: (event: AccountNamingEvent) => void,
): boolean {
  const { logError } = useLog();
  const [restoredFingerprint, setRestoredFingerprint] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!persistence || !signingFingerprint) {
      return;
    }
    let current = true;
    void loadPersistedAccountNaming(persistence, signingFingerprint)
      .then((naming) => {
        if (current && naming) {
          dispatch({
            fingerprint: signingFingerprint,
            naming,
            type: "restored",
          });
        }
      })
      .catch((error: unknown) => {
        logError("Could not read back the account name.", error);
        if (current) {
          dispatch({ fingerprint: signingFingerprint, type: "unreadable" });
        }
      })
      .finally(() => {
        if (current) setRestoredFingerprint(signingFingerprint);
      });
    return () => {
      current = false;
    };
  }, [dispatch, logError, persistence, signingFingerprint]);

  return persistence === null || restoredFingerprint === signingFingerprint;
}

/**
 * Keeps the sealed record in step with {@link sealedAccountNaming}, but only
 * once it has been read back: until then an `idle` state says nothing about
 * the record, and a restored session must not remove a name still on its way.
 * Whether a name was stored goes back to the machine, which holds
 * registration until it is.
 */
function useSealedAccountNaming(
  persistence: AccountNamingPersistence | null,
  signingFingerprint: string | null,
  state: AccountNamingState,
  settled: boolean,
  dispatch: (event: AccountNamingEvent) => void,
): void {
  const accountExists = useCryptoSession().userId !== null;
  const { isLocked } = useLocalKeyringLock();
  const { logError } = useLog();
  // One write at a time; each claims the record when queued, so neither a
  // slower earlier seal nor one from a runtime since replaced lands over a
  // later write.
  const writes = useRef(Promise.resolve());

  useEffect(() => {
    const sealed = sealedAccountNaming(state, accountExists);
    if (!signingFingerprint || !settled || sealed === undefined) {
      return;
    }
    const named =
      sealed?.status === "named"
        ? { fingerprint: signingFingerprint, name: sealed.name }
        : null;
    if (!persistence) {
      // An unlocked host that stores nothing has no restart to lose it to.
      if (named && !isLocked) dispatch({ ...named, type: "name-sealed" });
      return;
    }
    const claim = claimAccountNamingWrite(persistence);
    const write =
      sealed === null
        ? async () => removePersistedAccountNaming(persistence, claim)
        : () =>
            savePersistedAccountNaming(
              persistence,
              signingFingerprint,
              sealed,
              claim,
            );
    writes.current = writes.current.then(write).then(
      (written) => {
        // A superseded seal leaves the outcome to the write that replaced it.
        if (named && written) dispatch({ ...named, type: "name-sealed" });
      },
      (error: unknown) => {
        logError("Could not save the account name.", error);
        if (named) dispatch({ ...named, type: "seal-failed" });
      },
    );
  }, [
    accountExists,
    dispatch,
    isLocked,
    logError,
    persistence,
    settled,
    signingFingerprint,
    state,
  ]);
}

/**
 * The autopilot's {@link AccountNamingState}, read against the current
 * identity so a switch away leaves nothing to name. A submitted name applies
 * to the identity current at submission.
 */
export function useAccountNaming(): AccountNaming {
  const { signingFingerprint } = useIdentity();
  const [machine, dispatch] = useReducer(
    transitionAccountNaming,
    ACCOUNT_NAMING_IDLE,
  );
  const persistence = useAccountNamingPersistence(signingFingerprint);
  const settled = useRestoredAccountNaming(
    persistence,
    signingFingerprint,
    dispatch,
  );
  const state = accountNamingFor(machine, signingFingerprint);
  useSealedAccountNaming(
    persistence,
    signingFingerprint,
    state,
    settled,
    dispatch,
  );

  const identityNamed = useCallback((fingerprint: string, name: string) => {
    dispatch({
      fingerprint,
      naming: { name, status: "named" },
      type: "restored",
    });
  }, []);
  const contactNamed = useCallback((fingerprint: string) => {
    dispatch({ fingerprint, type: "contact-named" });
  }, []);
  const submit = useCallback(
    (name: string) => {
      if (signingFingerprint) {
        dispatch({
          fingerprint: signingFingerprint,
          name,
          type: "name-submitted",
        });
      }
    },
    [signingFingerprint],
  );

  return { contactNamed, identityNamed, settled, state, submit };
}
