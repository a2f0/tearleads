import { useEffect, useRef, useState } from "react";
import type { ContactEntry } from "../document-types/contact/contactDocumentModel";
import { useLog } from "../providers/logging/LogProvider";
import {
  ContactsProvider,
  useContacts,
} from "../stores/contacts/ContactsProvider";
import { isCurrentSelfContactLocalId } from "../stores/contacts/selfContact";

interface AccountNameContactSeederProps {
  readonly fingerprint: string;
  readonly name: string;
  /**
   * The self contact durably carries a nickname: this one once its write
   * settled, or one it already had.
   */
  readonly onNamed: () => void;
}

function SelfContactNicknameWriter({
  fingerprint,
  name,
  onNamed,
}: AccountNameContactSeederProps): null {
  const { canWrite, entries, ready, updateContact } = useContacts();
  const { logError } = useLog();
  // State rather than a ref, so the settled write re-runs the check below.
  const [writing, setWriting] = useState(false);
  const attempted = useRef<ContactEntry | null>(null);

  useEffect(() => {
    if (!ready || !canWrite || writing) {
      return;
    }
    const self = entries.find((entry) =>
      isCurrentSelfContactLocalId(entry.id, fingerprint),
    );
    if (!self) {
      return;
    }
    // With no write in flight a nickname is durable: loaded from storage, or
    // saved by a write that has settled (updateContact resolves once saved).
    if ((self.nickname ?? "").trim().length > 0) {
      onNamed();
      return;
    }
    // A write that settled without landing retries only once the contact
    // itself changes, never in a loop against the same entry.
    if (attempted.current === self) {
      return;
    }
    attempted.current = self;
    setWriting(true);
    void updateContact(self.id, { nickname: name })
      .catch((error: unknown) => {
        logError("Could not name your own contact.", error);
      })
      .finally(() => {
        setWriting(false);
      });
  }, [
    canWrite,
    entries,
    fingerprint,
    logError,
    name,
    onNamed,
    ready,
    updateContact,
    writing,
  ]);

  return null;
}

/**
 * Gives the self contact the name the user chose at first launch, once system
 * bootstrap has created it and it is writable. A nickname it already carries
 * is kept. Brings its own ContactsProvider so it runs whether or not the user
 * opens Contacts; the autopilot unmounts it once {@link
 * AccountNameContactSeederProps.onNamed} fires.
 */
export function AccountNameContactSeeder(props: AccountNameContactSeederProps) {
  return (
    <ContactsProvider>
      <SelfContactNicknameWriter {...props} />
    </ContactsProvider>
  );
}
