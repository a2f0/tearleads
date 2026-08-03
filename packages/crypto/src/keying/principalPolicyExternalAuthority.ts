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
    readonly version: number;
  };
}

export interface PrincipalPolicyExternalAuthorityVerifier {
  readonly authority: PrincipalPolicyExternalAuthority | undefined;
  readonly authorityStates: ReadonlyMap<
    string,
    PrincipalPolicyExternalAuthorityState
  >;
  readonly localCheckpointVersion: number | null;
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
  readonly localCheckpoint: { readonly version: number } | null | undefined;
}): PrincipalPolicyExternalAuthorityVerifier {
  return {
    authority: input.authority,
    authorityStates: buildExternalAuthorityStateMap(input.authority),
    localCheckpointVersion: input.localCheckpoint?.version ?? null,
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

  if (
    input.verifier.authority &&
    input.verifier.localCheckpointVersion !== null &&
    input.entry.state.version > input.verifier.localCheckpointVersion &&
    !externalAuthorityHeadsEqual(
      reference,
      input.verifier.authority.currentHead,
    )
  ) {
    throwVerification(
      "rollback",
      "principal policy successor cites a stale external authority head",
    );
  }

  input.verifier.latestReference = reference;
}
