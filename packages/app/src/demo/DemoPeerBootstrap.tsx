import { useEffect, useRef } from "react";
import {
  usePaneSide,
  usePeerUserId,
} from "../components/pane/DualPaneProvider";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useLog } from "../providers/logging/LogProvider";
import {
  ContactsProvider,
  useContacts,
} from "../stores/contacts/ContactsProvider";
import {
  type DemoPeerSeedAction,
  demoPeerSeedActionKey,
  planDemoPeerSeed,
} from "./demoPeerSeed";

async function runDemoPeerSeedAction(
  action: DemoPeerSeedAction,
  contacts: Pick<ReturnType<typeof useContacts>, "importKey" | "updateContact">,
): Promise<void> {
  if (action.kind === "set-nickname") {
    await contacts.updateContact(action.contactId, {
      nickname: action.nickname,
    });
    return;
  }

  const contactId = await contacts.importKey(action.userId);
  if (contactId) {
    await contacts.updateContact(contactId, { nickname: action.nickname });
  }
}

// Headless seeder: watches the shared contacts store and issues the friendly
// demo writes (self nickname + peer import) the moment their preconditions are
// met. Idempotent by construction — planDemoPeerSeed re-plans to nothing once
// each write lands — with an in-flight guard so a write is never issued twice
// while its earlier attempt is still resolving.
function DemoPeerContactSeeder({
  enabled,
}: {
  readonly enabled: boolean;
}): null {
  const side = usePaneSide();
  const peerUserId = usePeerUserId();
  const { isAuthenticated } = useCryptoSession();
  const { canWrite, entries, importKey, ready, updateContact } = useContacts();
  const { logError } = useLog();
  const pendingActionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const actions = planDemoPeerSeed({
      canWrite,
      entries,
      isAuthenticated,
      peerUserId,
      ready,
      side,
    });
    for (const action of actions) {
      const key = demoPeerSeedActionKey(action);
      if (pendingActionsRef.current.has(key)) {
        continue;
      }

      pendingActionsRef.current.add(key);
      void runDemoPeerSeedAction(action, { importKey, updateContact })
        .catch((error: unknown) => {
          logError("Demo peer bootstrap: failed to seed contact.", error);
        })
        .finally(() => {
          pendingActionsRef.current.delete(key);
        });
    }
  }, [
    canWrite,
    enabled,
    entries,
    importKey,
    isAuthenticated,
    logError,
    peerUserId,
    ready,
    side,
    updateContact,
  ]);

  return null;
}

/**
 * Demo-only friendly peer bootstrap. Mounted (gated on the
 * {@link AppHostFeatureFlags.seedPeerIdentities} host flag) inside each pane's
 * runtime so it can auto-import the opposite pane's peer contact and name the
 * self "You" contact after the pane's peer label. It provides its own
 * ContactsProvider so the seeding runs whether or not the user ever opens the
 * Contacts mini-app; the contacts store is shared per container, so its writes
 * surface in the mini-app immediately.
 */
export function DemoPeerBootstrap({
  enabled = true,
}: {
  readonly enabled?: boolean | undefined;
}) {
  return (
    <ContactsProvider>
      <DemoPeerContactSeeder enabled={enabled} />
    </ContactsProvider>
  );
}
