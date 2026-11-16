import { useEffect, useMemo, useReducer, useRef } from "react";
import { useLog } from "../providers/logging/LogProvider";
import { useContacts } from "../stores/contacts/ContactsProvider";
import { isCurrentSelfContactLocalId } from "../stores/contacts/selfContact";
import {
  SELF_CONTACT_NICKNAME_READY,
  selfContactNicknameStep,
  transitionSelfContactNickname,
} from "./selfContactNicknameMachine";

export interface SelfContactNicknameWriterProps {
  readonly fingerprint: string;
  readonly name: string;
  /** The self contact's nickname is saved: this one, or one it already had. */
  readonly onNamed: (fingerprint: string) => void;
}

/**
 * Names the current identity's account-bound self contact once it is loaded
 * and writable, keeping a nickname it already has. Only a save the store
 * acknowledges counts; see selfContactNicknameMachine.
 */
export function SelfContactNicknameWriter({
  fingerprint,
  name,
  onNamed,
}: SelfContactNicknameWriterProps): null {
  const { canWrite, entries, ready, updateContact } = useContacts();
  const { logError } = useLog();
  const [write, dispatch] = useReducer(
    transitionSelfContactNickname,
    SELF_CONTACT_NICKNAME_READY,
  );
  // Only the self contact bound to the account counts: a nickname written to
  // the device-only copy before sign-in does not survive its promotion.
  const self = useMemo(
    () =>
      ready && canWrite
        ? (entries.find(
            (entry) =>
              entry.userId !== null &&
              isCurrentSelfContactLocalId(entry.id, fingerprint),
          ) ?? null)
        : null,
    [canWrite, entries, fingerprint, ready],
  );
  const latest = useRef(self);
  latest.current = self;
  // A save that settles after the writer is gone reports nowhere.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!self) {
      return;
    }
    const step = selfContactNicknameStep(write, self);
    if (step === "named") {
      onNamed(fingerprint);
    }
    if (step !== "write") {
      return;
    }
    dispatch({ type: "write-started" });
    void updateContact(self.id, { nickname: name })
      .catch((error: unknown) => {
        logError("Could not name your own contact.", error);
        return false;
      })
      .then((saved) => {
        if (mounted.current) {
          dispatch({ contact: latest.current, saved, type: "write-settled" });
        }
      });
  }, [fingerprint, logError, name, onNamed, self, updateContact, write]);

  return null;
}
