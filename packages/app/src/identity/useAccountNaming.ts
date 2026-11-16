import { useCallback, useReducer } from "react";
import { useIdentity } from "../providers/identity/IdentityProvider";
import {
  ACCOUNT_NAMING_IDLE,
  type AccountNamingState,
  accountNamingFor,
  transitionAccountNaming,
} from "./accountNamingMachine";

export interface AccountNaming {
  /** The naming state of the current identity. */
  readonly state: AccountNamingState;
  readonly contactNamed: (fingerprint: string) => void;
  readonly identityGenerated: (fingerprint: string) => void;
  readonly submit: (name: string) => void;
}

/**
 * The autopilot's {@link AccountNamingState}, read against the current
 * identity so a switch away leaves nothing to name. A submitted name applies
 * to the identity current at submission.
 */
export function useAccountNaming(): AccountNaming {
  const { signingFingerprint } = useIdentity();
  const [state, dispatch] = useReducer(
    transitionAccountNaming,
    ACCOUNT_NAMING_IDLE,
  );
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

  return {
    contactNamed,
    identityGenerated,
    state: accountNamingFor(state, signingFingerprint),
    submit,
  };
}
