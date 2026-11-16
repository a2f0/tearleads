import { useEffect, useRef } from "react";
import { useLog } from "../providers/logging/LogProvider";
import {
  ContactsProvider,
  useContacts,
} from "../stores/contacts/ContactsProvider";
import { isCurrentSelfContactLocalId } from "../stores/contacts/selfContact";

interface AccountNameContactSeederProps {
  readonly fingerprint: string;
  readonly name: string;
  /** The self contact has a nickname: this one, or one it already carried. */
  readonly onNamed: () => void;
}

function SelfContactNicknameWriter({
  fingerprint,
  name,
  onNamed,
}: AccountNameContactSeederProps): null {
  const { canWrite, entries, ready, updateContact } = useContacts();
  const { logError } = useLog();
  const writing = useRef(false);

  useEffect(() => {
    if (!ready || !canWrite || writing.current) {
      return;
    }
    const self = entries.find((entry) =>
      isCurrentSelfContactLocalId(entry.id, fingerprint),
    );
    if (!self) {
      return;
    }
    if ((self.nickname ?? "").trim().length > 0) {
      onNamed();
      return;
    }

    // The latch keeps a re-render while the write is outstanding from issuing
    // it twice; the landed nickname then reports through the branch above.
    writing.current = true;
    void updateContact(self.id, { nickname: name })
      .catch((error: unknown) => {
        logError("Could not name your own contact.", error);
      })
      .finally(() => {
        writing.current = false;
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
