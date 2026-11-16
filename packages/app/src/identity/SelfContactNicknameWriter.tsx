import { useEffect, useMemo, useRef, useState } from "react";
import type { ContactEntry } from "../document-types/contact/contactDocumentModel";
import { useLog } from "../providers/logging/LogProvider";
import { useContacts } from "../stores/contacts/ContactsProvider";
import { isCurrentSelfContactLocalId } from "../stores/contacts/selfContact";

export interface SelfContactNicknameWriterProps {
  readonly fingerprint: string;
  readonly name: string;
  /** The self contact's nickname is saved: this one, or one it already had. */
  readonly onNamed: (fingerprint: string) => void;
}

/**
 * Names the current identity's account-bound self contact once it is loaded
 * and writable, keeping a nickname it already has. Only a save the store
 * acknowledges counts: a failed save can still show the nickname in memory,
 * so after one this page retries whenever the contact changes.
 */
export function SelfContactNicknameWriter({
  fingerprint,
  name,
  onNamed,
}: SelfContactNicknameWriterProps): null {
  const { canWrite, entries, ready, updateContact } = useContacts();
  const { logError } = useLog();
  // State rather than a ref, so a settled write re-runs the check below.
  const [writing, setWriting] = useState(false);
  const unsaved = useRef(false);
  const attempted = useRef<ContactEntry | null>(null);
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

  useEffect(() => {
    if (!self || writing) {
      return;
    }
    if ((self.nickname ?? "").trim().length > 0 && !unsaved.current) {
      onNamed(fingerprint);
      return;
    }
    // After a failed save, retry only once the contact changes again, not on
    // the change this page's own edit made.
    if (attempted.current === self) {
      return;
    }
    setWriting(true);
    void updateContact(self.id, { nickname: name })
      .then((saved) => {
        unsaved.current = !saved;
        if (saved) onNamed(fingerprint);
      })
      .catch((error: unknown) => {
        unsaved.current = true;
        logError("Could not name your own contact.", error);
      })
      .finally(() => {
        attempted.current = latest.current;
        setWriting(false);
      });
  }, [fingerprint, logError, name, onNamed, self, updateContact, writing]);

  return null;
}
