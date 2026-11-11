import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import type { PrincipalPolicyStateChainEntryResponse } from "@tearleads/validators/response";
import type { RecoveredPrincipalHistoryPage } from "../../principals/historyRecovery/loadRecoveredPrincipalHistoryPage";
import {
  initialRosterAdmissionScan,
  nextRosterAdmissionPage,
  transitionRosterAdmissionScan,
} from "./rosterAdmissionScanMachine";

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
  // Admission links look up memberships one at a time, so one page at most
  // is ever in flight.
  let scan = initialRosterAdmissionScan(head);

  async function entryAt(index: number) {
    if (index < scan.entries.length) return scan.entries[index];
    const next = nextRosterAdmissionPage(scan);
    if (!next) return undefined;
    scan = transitionRosterAdmissionScan(scan, { type: "pageRequested" });
    const page = await loadPage(head, next.beforeVersion);
    scan = transitionRosterAdmissionScan(scan, { type: "pageLoaded", page });
    return scan.entries[index];
  }

  return {
    /** For the recipient require presence at head; signers may have departed. */
    membershipStart: (userId: string, atVersion: number, current: boolean) =>
      membershipStart(entryAt, userId, atVersion, current),
  };
}
