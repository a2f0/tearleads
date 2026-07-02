import {
  type PaneSide,
  peerPaneLabel,
  selfPaneLabel,
} from "../components/pane/DualPaneProvider";
import type { ContactEntries } from "../mini-apps/contacts/types";

// A single friendly-seeding step for the demo. `set-nickname` renames an
// existing contact; `import-peer` fetches the peer's key into a new contact and
// then names it. Kept data-only so the decision logic is pure and unit-testable
// apart from the React effect that executes it.
export type DemoPeerSeedAction =
  | {
      readonly kind: "set-nickname";
      readonly contactId: string;
      readonly nickname: string;
    }
  | {
      readonly kind: "import-peer";
      readonly userId: string;
      readonly nickname: string;
    };

export interface DemoPeerSeedInput {
  readonly canWrite: boolean;
  readonly entries: ContactEntries;
  readonly isAuthenticated: boolean;
  readonly peerUserId: string | null;
  readonly ready: boolean;
  readonly side: PaneSide;
}

// A stable identity for an action so the executor can guard against issuing the
// same write twice while an earlier attempt is still in flight.
export function demoPeerSeedActionKey(action: DemoPeerSeedAction): string {
  return action.kind === "import-peer"
    ? `import-peer:${action.userId}`
    : `set-nickname:${action.contactId}:${action.nickname}`;
}

/**
 * Decides which friendly-identity writes the demo still owes for this pane. Pure
 * and idempotent: it seeds a nickname only when the target contact has none (so
 * a later user rename is never clobbered and a reload re-plans to nothing), and
 * imports the peer only once its user id is known and no contact for it exists
 * yet. Returns an empty list when nothing is owed or the pane cannot write.
 */
export function planDemoPeerSeed(
  input: DemoPeerSeedInput,
): DemoPeerSeedAction[] {
  const actions: DemoPeerSeedAction[] = [];
  if (!input.ready || !input.canWrite) {
    return actions;
  }

  // Behavior 2: name this pane's own "You" contact after its peer label.
  const selfEntry = input.entries.find((entry) => entry.isSelf);
  if (selfEntry && selfEntry.nickname.trim().length === 0) {
    actions.push({
      kind: "set-nickname",
      contactId: selfEntry.id,
      nickname: selfPaneLabel(input.side),
    });
  }

  // Behavior 1: import the opposite pane as a contact, named by its peer label.
  // Needs an authenticated session (importKey fetches the peer key from the
  // server) and the peer's user id (published once the peer pane registers).
  if (input.isAuthenticated && input.peerUserId) {
    const peerLabel = peerPaneLabel(input.side);
    const existingPeer = input.entries.find(
      (entry) => !entry.isSelf && entry.userId === input.peerUserId,
    );
    if (!existingPeer) {
      actions.push({
        kind: "import-peer",
        nickname: peerLabel,
        userId: input.peerUserId,
      });
    } else if (existingPeer.nickname.trim().length === 0) {
      actions.push({
        kind: "set-nickname",
        contactId: existingPeer.id,
        nickname: peerLabel,
      });
    }
  }

  return actions;
}
