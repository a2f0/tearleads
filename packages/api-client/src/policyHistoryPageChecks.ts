import { serializeKeyingCanonicalJson } from "@tearleads/crypto";
import {
  isPrincipalPolicyPageResponse,
  isPrincipalStateResponse,
  type PrincipalPolicyHistorySourceResponse,
  PrincipalPolicyHistorySourceResponseSchema,
  type PrincipalPolicyPageCurrent,
  type PrincipalPolicyPageResponse,
  type PrincipalPolicySnapshotPage,
  type PrincipalPolicySnapshotPageResponse,
  type PrincipalStateResponse,
} from "@tearleads/validators/response";

// Pure consistency checks for the two policy history pagers: whether a page
// continues the cursor chain toward its head, and whether a saved or held
// position may start one. They decide only what the transport accepts as the
// next page; the caller still authenticates every page's contents.

/** A transport position. Only the caller can authenticate the saved prefix. */
export interface PrincipalPolicyPageResume {
  readonly current: PrincipalPolicyPageCurrent;
  readonly afterVersion: number;
}

interface PolicyHistoryHead {
  readonly principalType: string;
  readonly principalId: string;
  readonly version: number;
}

interface PolicyHistorySlice {
  readonly previousStates: readonly { readonly state: PolicyHistoryHead }[];
  readonly historyPage: {
    readonly afterVersion: number;
    readonly nextAfterVersion: number | null;
  };
}

/**
 * Whether a page's history slice starts right after `afterVersion`, stays on
 * `head`'s principal in consecutive versions, ends before the head, and names
 * the next cursor exactly when history remains before the head.
 */
export function continuesPolicyHistory(
  page: PolicyHistorySlice,
  head: PolicyHistoryHead,
  afterVersion: number,
): boolean {
  const through = afterVersion + page.previousStates.length;
  return (
    page.historyPage.afterVersion === afterVersion &&
    through < head.version &&
    page.previousStates.every(
      ({ state }, index) =>
        state.version === afterVersion + index + 1 &&
        state.principalId === head.principalId &&
        state.principalType === head.principalType,
    ) &&
    (page.historyPage.nextAfterVersion === null
      ? through === head.version - 1
      : through > afterVersion &&
        through < head.version - 1 &&
        page.historyPage.nextAfterVersion === through)
  );
}

/** A policy page's pinned current artifacts. */
export function principalPolicyPageCurrent(
  page: PrincipalPolicyPageResponse,
): PrincipalPolicyPageCurrent {
  return {
    currentState: page.currentState,
    currentPayload: page.currentPayload,
    currentProjection: page.currentProjection,
    currentGrants: page.currentGrants,
    currentMemberEnvelopes: page.currentMemberEnvelopes,
  };
}

/** Whether a saved position names an earlier version of the requested head. */
export function validPrincipalPolicyResume(
  principalType: "group" | "organization",
  principalId: string,
  resume: PrincipalPolicyPageResume,
  stateHash: string | undefined,
): boolean {
  const state = resume.current.currentState;
  return (
    Number.isSafeInteger(resume.afterVersion) &&
    resume.afterVersion >= 0 &&
    resume.afterVersion < state.version &&
    state.principalType === principalType &&
    state.principalId === principalId &&
    (stateHash === undefined || state.stateHash === stateHash)
  );
}

/**
 * An owned copy of a well-formed saved position with the canonical bytes of
 * its current artifacts, which every later page must repeat; undefined when
 * it is absent or malformed.
 */
export function readPrincipalPolicyResume(
  input: PrincipalPolicyPageResume | undefined,
) {
  if (input === undefined) return undefined;
  try {
    const page = {
      ...input.current,
      previousStates: [],
      historyPage: { afterVersion: input.afterVersion, nextAfterVersion: null },
    };
    if (!isPrincipalPolicyPageResponse(page)) return undefined;
    const current = structuredClone(principalPolicyPageCurrent(page));
    return {
      current,
      afterVersion: page.historyPage.afterVersion,
      bytes: serializeKeyingCanonicalJson(current),
    };
  } catch {
    return undefined;
  }
}

/**
 * Whether a policy page is for the requested principal and head, repeats the
 * pinned current artifacts byte for byte once pinned, and continues the
 * history from `afterVersion`.
 */
export function validPrincipalPolicyPage(
  page: PrincipalPolicyPageResponse,
  expected: {
    principalType: "group" | "organization";
    principalId: string;
    stateHash: string | undefined;
    pinnedBytes: string | undefined;
    bytes: string;
    afterVersion: number;
  },
): boolean {
  return (
    page.currentState.principalType === expected.principalType &&
    page.currentState.principalId === expected.principalId &&
    (expected.stateHash === undefined ||
      page.currentState.stateHash === expected.stateHash) &&
    (expected.pinnedBytes === undefined ||
      expected.bytes === expected.pinnedBytes) &&
    continuesPolicyHistory(page, page.currentState, expected.afterVersion)
  );
}

/** Whether a signed state is exactly the head a history source names. */
export function matchesHistoryHead(
  state: PrincipalStateResponse,
  head: PrincipalPolicyHistorySourceResponse["head"],
): boolean {
  return (
    state.principalType === head.principalType &&
    state.principalId === head.principalId &&
    state.version === head.version &&
    state.stateHash === head.stateHash &&
    state.keyEpoch === head.keyEpoch &&
    state.keyFingerprint === head.keyFingerprint
  );
}

/**
 * The page with its current state: a held state replaces only an explicit
 * omission, and a served one must be absent from the request. Undefined when
 * the page omits a state the request did not hold, or serves one it did.
 */
export function projectionHistoryPageWithCurrent(
  page: PrincipalPolicySnapshotPageResponse,
  known: PrincipalStateResponse | undefined,
): PrincipalPolicySnapshotPage | undefined {
  if (known) {
    return page.currentState === null
      ? { ...page, currentState: structuredClone(known) }
      : undefined;
  }
  const currentState = page.currentState;
  return currentState === null ? undefined : { ...page, currentState };
}

/** Whether a projection history page is on the source's head and continues its history. */
export function validProjectionHistoryPage(
  page: PrincipalPolicySnapshotPage,
  source: PrincipalPolicyHistorySourceResponse,
  afterVersion: number,
): boolean {
  return (
    matchesHistoryHead(page.currentState, source.head) &&
    continuesPolicyHistory(page, source.head, afterVersion)
  );
}

/** Owned copies of a valid source, cursor and held head, or undefined. */
export function readProjectionHistoryStart(
  input: PrincipalPolicyHistorySourceResponse,
  options: {
    readonly afterVersion?: number | undefined;
    readonly knownCurrentState?: PrincipalStateResponse | undefined;
  },
) {
  const parsed = PrincipalPolicyHistorySourceResponseSchema.safeParse(input);
  const afterVersion = options.afterVersion ?? 0;
  const known = options.knownCurrentState;
  if (
    !parsed.success ||
    !Number.isSafeInteger(afterVersion) ||
    afterVersion < 0 ||
    afterVersion >= parsed.data.head.version ||
    (known !== undefined &&
      (!isPrincipalStateResponse(known) ||
        !matchesHistoryHead(known, parsed.data.head)))
  )
    return undefined;
  return {
    source: structuredClone(parsed.data),
    afterVersion,
    knownCurrentState: known && structuredClone(known),
  };
}
