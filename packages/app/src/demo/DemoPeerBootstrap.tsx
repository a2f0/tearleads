import { useEffect, useRef } from "react";
import {
  peerPaneLabel,
  usePaneSide,
  usePeerUserId,
} from "../components/pane/dual-pane";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useLog } from "../providers/logging/LogProvider";
import { useSymCryptRuntime } from "../providers/sdk/SymCryptProvider";
import {
  ContactsProvider,
  useContacts,
} from "../stores/contacts/ContactsProvider";
import {
  OrgManagerProvider,
  useOrgManagerActions,
} from "../stores/org-manager/OrgManagerProvider";
import {
  attemptPeerRosterSeed,
  shouldAttemptRosterSeed,
} from "./demoPeerRosterSeed";
import {
  type DemoPeerSeedAction,
  demoPeerSeedActionKey,
  isSupersededByPendingImport,
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
      if (
        pendingActionsRef.current.has(key) ||
        isSupersededByPendingImport(action, entries, pendingActionsRef.current)
      ) {
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

// How many times to re-attempt the roster seed, and how long to wait between
// attempts. The peer's user id is published over the client-side dual-pane
// channel independently of the server-side user-identity registration, so
// the first attempt can race ahead of the peer's key becoming queryable; a
// bounded retry closes that gap without polling forever if the peer never
// finishes registering.
const ROSTER_SEED_MAX_ATTEMPTS = 10;
const ROSTER_SEED_RETRY_MS = 2000;

// Headless seeder: once this pane is authenticated with its personal org and the
// peer's user id is known, adds the peer to the pane's own member group so the
// peer appears on the pane's roster and gives the peer's roster entry a friendly
// nickname ("Peer 2"). Retries a bounded number of times while the preconditions
// (directory, member list, peer key, roster sync) settle. Idempotent by
// construction — each attempt re-checks state and settles once the peer is on
// the roster with a profile document — and the `active` flag cancels a
// superseded effect run so only the latest retry loop stays live.
function DemoPeerRosterSeeder({
  enabled,
}: {
  readonly enabled: boolean;
}): null {
  const side = usePaneSide();
  const peerUserId = usePeerUserId();
  const runtime = useSymCryptRuntime();
  const orgManagerActions = useOrgManagerActions();
  const { logError } = useLog();
  // Holds the peer id whose roster seed has settled, so a changed peer (a
  // re-registered or switched identity) is treated as unsettled and re-seeded
  // rather than skipped.
  const settledPeerRef = useRef<string | null>(null);
  const peerNickname = peerPaneLabel(side);

  // The signing/encapsulation material and resolved org/user id the member-group
  // policy write needs (mirrors the org-manager `canImportRosterUser` gate).
  const canWrite = Boolean(
    runtime.auth.organizationId &&
      runtime.auth.userId &&
      runtime.crypto.signingFingerprint &&
      runtime.crypto.signingKeyPair &&
      runtime.crypto.encapsulationKeyPair,
  );
  const canSeedRoster = shouldAttemptRosterSeed({
    canWrite,
    isAuthenticated: runtime.auth.isAuthenticated,
    peerUserId,
  });

  useEffect(() => {
    if (
      !enabled ||
      settledPeerRef.current === peerUserId ||
      !canSeedRoster ||
      !peerUserId
    ) {
      return;
    }
    const targetPeerUserId = peerUserId;

    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const stopAfterIdentityIntegrityFailure = (error: unknown): void => {
      active = false;
      logError(
        "Demo peer bootstrap: stopped roster seeding after an identity integrity failure.",
        error,
      );
    };
    const startAttempt = (): void => {
      void attempt().catch(stopAfterIdentityIntegrityFailure);
    };
    async function attempt(): Promise<void> {
      if (!active || settledPeerRef.current === targetPeerUserId) {
        return;
      }

      const settled = await attemptPeerRosterSeed(
        orgManagerActions,
        targetPeerUserId,
        peerNickname,
        logError,
      );
      if (!active) {
        return;
      }
      if (settled) {
        settledPeerRef.current = targetPeerUserId;
        return;
      }

      attempts += 1;
      if (attempts < ROSTER_SEED_MAX_ATTEMPTS) {
        retryTimer = setTimeout(startAttempt, ROSTER_SEED_RETRY_MS);
      } else {
        logError(
          `Demo peer bootstrap: gave up seeding the peer roster entry after ${ROSTER_SEED_MAX_ATTEMPTS} attempts.`,
        );
      }
    }

    startAttempt();
    return () => {
      active = false;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [
    canSeedRoster,
    enabled,
    logError,
    orgManagerActions,
    peerNickname,
    peerUserId,
  ]);

  return null;
}

/**
 * Demo-only friendly peer bootstrap. Mounted (gated on the
 * {@link AppHostFeatureFlags.seedPeerIdentities} host flag) inside each pane's
 * runtime so it can auto-import the opposite pane's peer contact, name the self
 * contact after the pane's peer label, and add the peer to the pane's own
 * organization roster with a friendly nickname. Each seeder provides its own
 * store context (ContactsProvider / OrgManagerProvider) so the seeding runs
 * whether or not the user ever opens the corresponding mini-app.
 */
export function DemoPeerBootstrap({
  enabled = true,
}: {
  readonly enabled?: boolean | undefined;
}) {
  return (
    <>
      <ContactsProvider>
        <DemoPeerContactSeeder enabled={enabled} />
      </ContactsProvider>
      <OrgManagerProvider>
        <DemoPeerRosterSeeder enabled={enabled} />
      </OrgManagerProvider>
    </>
  );
}
