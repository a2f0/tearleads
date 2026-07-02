import { useEffect, useRef } from "react";
import {
  usePaneSide,
  usePeerUserId,
} from "../components/pane/DualPaneProvider";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useLog } from "../providers/logging/LogProvider";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../providers/sdk/TearleadsProvider";
import {
  ContactsProvider,
  useContacts,
} from "../stores/contacts/ContactsProvider";
import {
  isPeerOnRoster,
  planDemoPeerRosterSeed,
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

// Adds the peer to this pane's own organization roster by adding them to the
// builtin member group (the server derives roster entries from member-group
// reachability — there is no direct add-roster-entry API). Returns whether the
// seed is settled: `true` once the peer is on the roster or the add lands,
// `false` when org/peer state is not ready yet so the caller retries later.
async function seedPeerRosterEntry(
  organizations: Pick<
    ReturnType<typeof useTearleads>["organizations"],
    | "addUserToGroup"
    | "importUserById"
    | "loadDirectoryAndGroups"
    | "loadGroupDetails"
  >,
  peerUserId: string,
): Promise<boolean> {
  const directoryAndGroups = await organizations.loadDirectoryAndGroups();
  const directory = directoryAndGroups?.directory ?? null;
  const memberGroupId = directoryAndGroups?.memberGroupId ?? null;
  if (!directory || !memberGroupId) {
    return false;
  }
  if (isPeerOnRoster(directory, peerUserId)) {
    return true;
  }

  const { members } = await organizations.loadGroupDetails(memberGroupId);
  if (!members) {
    // Without the authoritative member list the policy re-encryption could omit
    // existing members; wait and retry rather than risk locking them out.
    return false;
  }
  const plan = planDemoPeerRosterSeed({
    directory,
    memberGroupId,
    members,
    peerUserId,
  });
  if (plan.kind === "idle") {
    return true;
  }

  const targetUser =
    plan.existingRecipient ?? (await organizations.importUserById(peerUserId));
  if (!targetUser) {
    return false;
  }

  await organizations.addUserToGroup({
    canAdministerOrganization: plan.canAdministerOrganization,
    currentUsers: plan.currentUsers,
    groupId: plan.memberGroupId,
    targetUser,
  });
  return true;
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

// One roster-seed attempt, with failures folded into a `false` (not-settled)
// result so the retry loop can treat errors and unmet preconditions alike.
async function attemptPeerRosterSeed(
  organizations: Parameters<typeof seedPeerRosterEntry>[0],
  peerUserId: string,
  logError: (message: string, error: unknown) => void,
): Promise<boolean> {
  try {
    return await seedPeerRosterEntry(organizations, peerUserId);
  } catch (error) {
    logError("Demo peer bootstrap: failed to seed peer roster entry.", error);
    return false;
  }
}

// How many times to re-attempt the roster seed, and how long to wait between
// attempts. The peer's user id is published over the client-side dual-pane
// channel independently of the server-side encapsulation-key registration, so
// the first attempt can race ahead of the peer's key becoming queryable; a
// bounded retry closes that gap without polling forever if the peer never
// finishes registering.
const ROSTER_SEED_MAX_ATTEMPTS = 10;
const ROSTER_SEED_RETRY_MS = 2000;

// Headless seeder: once this pane is authenticated with its personal org and the
// peer's user id is known, adds the peer to the pane's own member group so the
// peer appears on the pane's roster. Retries a bounded number of times while the
// preconditions (directory, member list, peer key) settle; a settled/in-flight
// guard keeps it idempotent and never issues overlapping writes.
function DemoPeerRosterSeeder({
  enabled,
}: {
  readonly enabled: boolean;
}): null {
  const peerUserId = usePeerUserId();
  const runtime = useTearleadsRuntime();
  const { organizations } = useTearleads();
  const { logError } = useLog();
  const settledRef = useRef(false);
  const inFlightRef = useRef(false);

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
    if (!enabled || settledRef.current || !canSeedRoster || !peerUserId) {
      return;
    }

    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const attempt = async (): Promise<void> => {
      if (!active || settledRef.current || inFlightRef.current) {
        return;
      }

      inFlightRef.current = true;
      const settled = await attemptPeerRosterSeed(
        organizations,
        peerUserId,
        logError,
      );
      inFlightRef.current = false;
      if (!active) {
        return;
      }
      if (settled) {
        settledRef.current = true;
        return;
      }

      attempts += 1;
      if (attempts < ROSTER_SEED_MAX_ATTEMPTS) {
        retryTimer = setTimeout(() => void attempt(), ROSTER_SEED_RETRY_MS);
      }
    };

    void attempt();
    return () => {
      active = false;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [canSeedRoster, enabled, logError, organizations, peerUserId]);

  return null;
}

/**
 * Demo-only friendly peer bootstrap. Mounted (gated on the
 * {@link AppHostFeatureFlags.seedPeerIdentities} host flag) inside each pane's
 * runtime so it can auto-import the opposite pane's peer contact, name the self
 * "You" contact after the pane's peer label, and add the peer to the pane's own
 * organization roster. The contact seeder provides its own ContactsProvider so
 * the seeding runs whether or not the user ever opens the Contacts mini-app; the
 * roster seeder talks to the SDK organizations service directly.
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
      <DemoPeerRosterSeeder enabled={enabled} />
    </>
  );
}
