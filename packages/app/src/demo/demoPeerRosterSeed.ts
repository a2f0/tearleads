import { KeyingVerificationError } from "@tearleads/crypto";
import {
  type RosterSeedActions,
  seedRosterEntry,
} from "../stores/org-manager/rosterSeed";

// Demo-only roster seeding. The demo panes each register their own personal
// organization and add the opposite pane's peer to its roster through the
// shared roster seeder (stores/org-manager/rosterSeed.ts), nicknamed after the
// peer's pane. This module holds the demo's gate and its logging wrapper, kept
// pure so they are unit-testable apart from the React effect that retries.

// Preconditions the pane must satisfy before it can attempt to seed the peer
// onto its roster. Mirrors the org-manager `canImportRosterUser` gate: an
// authenticated session with a resolved organization and user id plus the
// local signing/encapsulation material the member-group policy write requires.
interface DemoPeerRosterSeedGate {
  readonly canWrite: boolean;
  readonly isAuthenticated: boolean;
  readonly peerUserId: string | null;
}

export function shouldAttemptRosterSeed(gate: DemoPeerRosterSeedGate): boolean {
  return (
    gate.canWrite &&
    gate.isAuthenticated &&
    (gate.peerUserId ?? "").trim().length > 0
  );
}

export async function attemptPeerRosterSeed(
  actions: RosterSeedActions,
  peerUserId: string,
  peerNickname: string,
  logError: (message: string, error: unknown) => void,
): Promise<boolean> {
  try {
    return await seedRosterEntry(actions, peerUserId, {
      nickname: peerNickname,
    });
  } catch (error) {
    if (error instanceof KeyingVerificationError) {
      throw error;
    }
    logError("Demo peer bootstrap: failed to seed peer roster entry.", error);
    return false;
  }
}
