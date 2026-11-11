import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import type { PrincipalPolicyStateChainEntryResponse } from "@tearleads/validators/response";
import type { RecoveredPrincipalHistoryPage } from "../../principals/historyRecovery/loadRecoveredPrincipalHistoryPage";

const MAX_HISTORY_PAGES = 64;
const MAX_PAGE_ENTRIES = 32;

type ChainEntry = PrincipalPolicyStateChainEntryResponse;

/**
 * One backwards scan of a Members chain from its exact head. `scanning` holds
 * the hash-linked cursor the next page must extend and the page budget used.
 * `ended` reads no further page: the chain reached genesis or its last page,
 * or a page broke the link. Both keep the accepted entries, newest first.
 */
export type RosterAdmissionScanState =
  | {
      readonly status: "scanning";
      readonly head: ReferencedPrincipalHead;
      readonly entries: readonly ChainEntry[];
      readonly beforeVersion: number | undefined;
      readonly expectedVersion: number;
      readonly expectedHash: string | null;
      readonly pagesRequested: number;
    }
  | { readonly status: "ended"; readonly entries: readonly ChainEntry[] };

export type RosterAdmissionScanEvent =
  | { readonly type: "pageRequested" }
  | {
      readonly type: "pageLoaded";
      readonly page: RecoveredPrincipalHistoryPage;
    };

export function initialRosterAdmissionScan(
  head: ReferencedPrincipalHead,
): RosterAdmissionScanState {
  return {
    status: "scanning",
    head,
    entries: [],
    beforeVersion: undefined,
    expectedVersion: head.version,
    expectedHash: head.stateHash,
    pagesRequested: 0,
  };
}

/** The cursor of the next page to read, or null when the scan reads no more. */
export function nextRosterAdmissionPage(
  state: RosterAdmissionScanState,
): { readonly beforeVersion: number | undefined } | null {
  return state.status === "scanning" && state.pagesRequested < MAX_HISTORY_PAGES
    ? { beforeVersion: state.beforeVersion }
    : null;
}

/** An ended scan ignores both events; a page never reopens it. */
export function transitionRosterAdmissionScan(
  state: RosterAdmissionScanState,
  event: RosterAdmissionScanEvent,
): RosterAdmissionScanState {
  switch (state.status) {
    case "ended":
      return state;
    case "scanning":
      switch (event.type) {
        case "pageRequested":
          return { ...state, pagesRequested: state.pagesRequested + 1 };
        case "pageLoaded":
          return acceptPage(state, event.page);
        default:
          return assertNever(event);
      }
    default:
      return assertNever(state);
  }
}

/** Publish only a fully accepted page to subsequent membership lookups. */
function acceptPage(
  state: Extract<RosterAdmissionScanState, { status: "scanning" }>,
  page: RecoveredPrincipalHistoryPage,
): RosterAdmissionScanState {
  const rejected = { status: "ended", entries: state.entries } as const;
  if (page.entries.length === 0 || page.entries.length > MAX_PAGE_ENTRIES)
    return rejected;
  const batch = [...page.entries].reverse();
  const cursor = extendCursor(
    batch,
    state.head,
    state.expectedVersion,
    state.expectedHash,
  );
  if (!cursor) return rejected;
  if (
    cursor.version !== 0 &&
    page.nextBeforeVersion !== null &&
    page.nextBeforeVersion !== cursor.version + 1
  )
    return rejected;
  const entries = [...state.entries, ...batch];
  if (cursor.version === 0 || page.nextBeforeVersion === null)
    return { status: "ended", entries };
  return {
    ...state,
    entries,
    beforeVersion: page.nextBeforeVersion,
    expectedVersion: cursor.version,
    expectedHash: cursor.hash,
  };
}

function extendCursor(
  batch: readonly ChainEntry[],
  head: ReferencedPrincipalHead,
  version: number,
  hash: string | null,
): { version: number; hash: string | null } | null {
  for (const { state } of batch) {
    if (
      state.principalType !== head.principalType ||
      state.principalId !== head.principalId ||
      state.version !== version ||
      state.stateHash !== hash
    )
      return null;
    version -= 1;
    hash = state.prevStateHash;
  }
  return { version, hash };
}

function assertNever(value: never): never {
  throw new Error(
    `Unexpected roster admission scan input: ${JSON.stringify(value)}`,
  );
}
