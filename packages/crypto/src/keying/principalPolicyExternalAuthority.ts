import type { PrincipalStateExternalAuthority } from "../principalState";
import type {
  PrincipalPolicyExternalAuthority,
  PrincipalPolicyExternalAuthorityState,
} from "./principalPolicyExternalAuthorityTypes";
import { throwVerification } from "./shared";

interface ExternalAuthorityPolicyEntry {
  readonly state: {
    readonly externalAuthority: PrincipalStateExternalAuthority | null;
    readonly signerUserId: string;
  };
}

export interface PrincipalPolicyExternalAuthorityVerifier {
  readonly authorityStates: ReadonlyMap<
    string,
    PrincipalPolicyExternalAuthorityState
  >;
  latestReference: PrincipalStateExternalAuthority | null;
}

function externalAuthorityHeadKey(
  head: PrincipalStateExternalAuthority,
): string {
  return [
    head.principalType,
    head.principalId,
    head.version,
    head.keyEpoch,
    head.stateHash,
    head.keyFingerprint,
  ].join(":");
}

function externalAuthorityHeadsEqual(
  left: PrincipalStateExternalAuthority,
  right: PrincipalStateExternalAuthority,
): boolean {
  return externalAuthorityHeadKey(left) === externalAuthorityHeadKey(right);
}

function buildExternalAuthorityStateMap(
  authority: PrincipalPolicyExternalAuthority | undefined,
): ReadonlyMap<string, PrincipalPolicyExternalAuthorityState> {
  if (!authority) {
    return new Map();
  }

  const statesByHead = new Map<string, PrincipalPolicyExternalAuthorityState>();
  for (const state of authority.states) {
    const key = externalAuthorityHeadKey(state.head);
    if (statesByHead.has(key)) {
      throwVerification(
        "duplicate_entry",
        "external authority contains a duplicate policy head",
      );
    }
    statesByHead.set(key, state);
  }

  // Bundle consistency only: the current head is not a freshness requirement
  // for historical citations. Honest successors can arrive after it advances.
  if (!statesByHead.has(externalAuthorityHeadKey(authority.currentHead))) {
    throwVerification(
      "missing_dependency",
      "external authority current head is missing from its state history",
    );
  }

  return statesByHead;
}

export function createPrincipalPolicyExternalAuthorityVerifier(input: {
  readonly authority: PrincipalPolicyExternalAuthority | undefined;
}): PrincipalPolicyExternalAuthorityVerifier {
  return {
    authorityStates: buildExternalAuthorityStateMap(input.authority),
    latestReference: null,
  };
}

export function externalAuthorityIncludesAdminSigner(input: {
  readonly entry: ExternalAuthorityPolicyEntry;
  readonly verifier: PrincipalPolicyExternalAuthorityVerifier;
}): boolean {
  const reference = input.entry.state.externalAuthority;
  if (!reference) {
    return false;
  }

  const authorityState = input.verifier.authorityStates.get(
    externalAuthorityHeadKey(reference),
  );
  return authorityState
    ? authorityState.projection.some(
        (member) =>
          member.userId === input.entry.state.signerUserId &&
          member.role === "admin",
      )
    : false;
}

export function verifyPrincipalPolicyExternalAuthorityProgress(input: {
  readonly entry: ExternalAuthorityPolicyEntry;
  readonly verifier: PrincipalPolicyExternalAuthorityVerifier;
}): void {
  const reference = input.entry.state.externalAuthority;
  if (!reference) {
    return;
  }

  const previousReference = input.verifier.latestReference;
  if (
    previousReference &&
    (reference.principalId !== previousReference.principalId ||
      reference.version < previousReference.version ||
      (reference.version === previousReference.version &&
        !externalAuthorityHeadsEqual(reference, previousReference)))
  ) {
    throwVerification(
      "rollback",
      "principal policy external authority head rolled back",
    );
  }

  input.verifier.latestReference = reference;
}
