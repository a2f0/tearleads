import {
  classifyDatabaseFailure,
  retryWhileDatabaseBusy,
} from "@tearleads/client-sdk/sqlite";
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

/**
 * How one roster seed attempt ended. `busy` is an attempt the SQLite worker
 * kept refusing behind another tab's transaction, which spends none of the
 * demo's attempts (#3360).
 */
export type PeerRosterSeedOutcome = "settled" | "unsettled" | "busy";

export async function attemptPeerRosterSeed(
  actions: RosterSeedActions,
  peerUserId: string,
  peerNickname: string,
  logger: {
    readonly log: (message: string) => void;
    readonly logError: (message: string, error: unknown) => void;
  },
  isCurrent?: () => boolean,
): Promise<PeerRosterSeedOutcome> {
  try {
    // A pane whose peer changed stops before seeding a stale peer again.
    const settled = await retryWhileDatabaseBusy(
      () => seedRosterEntry(actions, peerUserId, { nickname: peerNickname }),
      { isCurrent },
    );
    return settled ? "settled" : "unsettled";
  } catch (error) {
    if (error instanceof KeyingVerificationError) {
      throw error;
    }
    const message = "Demo peer bootstrap: failed to seed peer roster entry.";
    // A refusal behind another tab's transaction is retried, not reported.
    if (classifyDatabaseFailure(error) === "busy") {
      logger.log(`${message} The database is busy in another tab.`);
      return "busy";
    }
    logger.logError(message, error);
    return "unsettled";
  }
}

/** Attempts a demo retry loop has spent after one more failure. */
export function demoAttemptsAfterFailure(
  attempts: number,
  error: unknown,
): number {
  return classifyDatabaseFailure(error) === "busy" ? attempts : attempts + 1;
}
