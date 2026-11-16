import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useLog } from "../providers/logging/LogProvider";
import {
  ACCOUNT_NAMING_IDLE,
  type AccountNamingState,
  accountNamingFor,
  type PersistedAccountNaming,
  transitionAccountNaming,
} from "./accountNamingMachine";
import {
  type AccountNamingPersistence,
  loadPersistedAccountNaming,
  savePersistedAccountNaming,
  useAccountNamingPersistence,
} from "./accountNamingPersistence";

export interface AccountNaming {
  /** The naming state of the current identity. */
  readonly state: AccountNamingState;
  /**
   * Whether the current identity's sealed naming has been read back, so
   * registration cannot run ahead of a name given before a restart.
   */
  readonly settled: boolean;
  readonly contactNamed: (fingerprint: string) => void;
  readonly identityGenerated: (fingerprint: string) => void;
  readonly submit: (name: string) => void;
}

/** Reads the current identity's sealed naming back once per identity. */
function useRestoredAccountNaming(
  persistence: AccountNamingPersistence | null,
  signingFingerprint: string | null,
  dispatch: (event: {
    readonly fingerprint: string;
    readonly naming: PersistedAccountNaming;
    readonly type: "restored";
  }) => void,
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

/** Seals the naming until the account exists, then removes it. */
function useSealedAccountNaming(
  persistence: AccountNamingPersistence | null,
  signingFingerprint: string | null,
  state: AccountNamingState,
): void {
  const { userId } = useCryptoSession();
  const { logError } = useLog();
  // One write at a time, so a slow earlier seal never lands over a later one.
  const writes = useRef(Promise.resolve());
  const name = state.status === "named" ? state.name : null;

  useEffect(() => {
    if (!persistence || !signingFingerprint) {
      return;
    }
    const write =
      userId !== null
        ? async () => persistence.storage.removeItem(persistence.storageKey)
        : state.status === "idle"
          ? null
          : () =>
              savePersistedAccountNaming(
                persistence,
                signingFingerprint,
                name === null
                  ? { status: "awaiting" }
                  : { name, status: "named" },
              );
    if (!write) {
      return;
    }
    writes.current = writes.current.then(write).catch((error: unknown) => {
      logError("Could not save the account name.", error);
    });
  }, [logError, name, persistence, signingFingerprint, state.status, userId]);
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
  useSealedAccountNaming(persistence, signingFingerprint, state);

  const identityGenerated = useCallback((fingerprint: string) => {
    dispatch({ fingerprint, type: "identity-generated" });
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

  return { contactNamed, identityGenerated, settled, state, submit };
}
