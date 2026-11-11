import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import type { PrincipalPolicyStateChainEntryResponse } from "@tearleads/validators/response";
import type { RecoveredPrincipalHistoryPage } from "../../principals/historyRecovery/loadRecoveredPrincipalHistoryPage";

const MAX_HISTORY_PAGES = 64;
const MAX_PAGE_ENTRIES = 32;

function matchesCursor(
  state: PrincipalPolicyStateChainEntryResponse["state"],
  head: ReferencedPrincipalHead,
  version: number,
  hash: string | null,
): boolean {
  return (
    state.principalType === head.principalType &&
    state.principalId === head.principalId &&
    state.version === version &&
    state.stateHash === hash
  );
}

function extendCursor(
  batch: readonly PrincipalPolicyStateChainEntryResponse[],
  head: ReferencedPrincipalHead,
  version: number,
  hash: string | null,
): { version: number; hash: string | null } | null {
  for (const { state } of batch) {
    if (!matchesCursor(state, head, version, hash)) return null;
    version -= 1;
    hash = state.prevStateHash;
  }
  return { version, hash };
}

async function membershipStart(
  entryAt: (
    index: number,
  ) => Promise<PrincipalPolicyStateChainEntryResponse | undefined>,
  userId: string,
  atVersion: number,
  current: boolean,
) {
  let start: PrincipalPolicyStateChainEntryResponse | null = null;
  for (let index = 0; ; index += 1) {
    const entry = await entryAt(index);
    if (!entry) return null;
    if (entry.state.version > atVersion) continue;
    const member = entry.projection.find((item) => item.userId === userId);
    if (!member) {
      if (start || current) return start;
      continue;
    }
    start = entry;
    if (entry.state.version === 1) return start;
  }
}

/** One bounded backwards scan, shared by every link in the admission chain. */
export function createRosterAdmissionHistory(
  head: ReferencedPrincipalHead,
  loadPage: (
    head: ReferencedPrincipalHead,
    beforeVersion: number | undefined,
  ) => Promise<RecoveredPrincipalHistoryPage>,
) {
  const entries: PrincipalPolicyStateChainEntryResponse[] = [];
  let beforeVersion: number | undefined;
  let expectedVersion = head.version;
  let expectedHash: string | null = head.stateHash;
  let pages = 0;
  let exhausted = false;

  async function entryAt(index: number) {
    if (index < entries.length) return entries[index];
    if (exhausted || pages >= MAX_HISTORY_PAGES) return undefined;
    pages += 1;
    const page = await loadPage(head, beforeVersion);
    if (page.entries.length === 0 || page.entries.length > MAX_PAGE_ENTRIES) {
      exhausted = true;
      return undefined;
    }
    const batch = [...page.entries].reverse();
    const cursor = extendCursor(batch, head, expectedVersion, expectedHash);
    if (!cursor) {
      exhausted = true;
      return undefined;
    }
    if (
      cursor.version !== 0 &&
      page.nextBeforeVersion !== null &&
      page.nextBeforeVersion !== cursor.version + 1
    ) {
      exhausted = true;
      return undefined;
    }
    // Publish only a fully accepted page to subsequent membership lookups.
    expectedVersion = cursor.version;
    expectedHash = cursor.hash;
    entries.push(...batch);
    exhausted = expectedVersion === 0 || page.nextBeforeVersion === null;
    beforeVersion = page.nextBeforeVersion ?? undefined;
    return entries[index];
  }

  return {
    /** For the recipient require presence at head; signers may have departed. */
    membershipStart: (userId: string, atVersion: number, current: boolean) =>
      membershipStart(entryAt, userId, atVersion, current),
  };
}
