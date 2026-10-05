import type { PrincipalStateExternalAuthority } from "../principalState";
import {
  normalizePrincipalPolicyStateChainEntry,
  verifyInitialPrincipalPolicyChainEntry,
  verifyPrincipalPolicyChainEntryIdentity,
  verifySuccessorPrincipalPolicyChainEntry,
} from "./principalPolicyChainEntry";
import {
  createPrincipalPolicyExternalAuthorityVerifier,
  verifyPrincipalPolicyExternalAuthorityProgress,
} from "./principalPolicyExternalAuthority";
import {
  PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT,
  type PrincipalPolicyHistoryPage,
} from "./principalPolicyHistoryTypes";
import { principalPolicyStateMatchesReference } from "./principalPolicyReference";
import { verifyPrincipalPolicyChainSignatures } from "./principalPolicySignatures";
import { buildPrincipalPolicySignerKeyMap } from "./principalPolicySignerKeys";
import { throwVerification } from "./shared";
import type {
  NormalizedPrincipalPolicyStateChainEntry,
  PrincipalPolicyCheckpoint,
  ReferencedPrincipalHead,
} from "./types";

function ownPage(page: PrincipalPolicyHistoryPage): PrincipalPolicyHistoryPage {
  if (
    page.entries.length < 1 ||
    page.entries.length > PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT ||
    page.signerPublicKeys.length > PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT ||
    (page.externalAuthority?.states.length ?? 0) >
      PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT + 1
  )
    throwVerification(
      "invalid_shape",
      "principal history page exceeds its entry budget",
    );
  // Copy before the first await: caller edits cannot change verified progress.
  return structuredClone(page);
}

export async function verifyPrincipalHistoryPage(input: {
  readonly page: PrincipalPolicyHistoryPage;
  readonly principalId: string;
  readonly principalType: ReferencedPrincipalHead["principalType"];
  readonly previous: NormalizedPrincipalPolicyStateChainEntry | undefined;
  readonly latestAuthority: PrincipalStateExternalAuthority | null;
  readonly references: readonly ReferencedPrincipalHead[];
  readonly checkpoint: PrincipalPolicyCheckpoint | null;
}) {
  const owned = ownPage(input.page);
  const signerKeys = await buildPrincipalPolicySignerKeyMap(
    owned.signerPublicKeys,
  );
  const authority = createPrincipalPolicyExternalAuthorityVerifier({
    authority: owned.externalAuthority,
  });
  authority.latestReference = input.latestAuthority;
  let previous = input.previous;
  const entries: NormalizedPrincipalPolicyStateChainEntry[] = [];
  for (const entry of owned.entries) {
    const current = await normalizePrincipalPolicyStateChainEntry(entry);
    verifyPrincipalPolicyChainEntryIdentity({
      currentState: {
        ...current.state,
        principalId: input.principalId,
        principalType: input.principalType,
      },
      expectedVersion: (previous?.state.version ?? 0) + 1,
      normalizedEntry: current,
    });
    if (previous)
      verifySuccessorPrincipalPolicyChainEntry({
        authorityVerifier: authority,
        normalizedEntry: current,
        previousEntry: previous,
      });
    else
      verifyInitialPrincipalPolicyChainEntry({
        authorityVerifier: authority,
        normalizedEntry: current,
      });
    verifyPrincipalPolicyExternalAuthorityProgress({
      entry: current,
      verifier: authority,
    });
    if (
      input.references.some(
        (reference) =>
          reference.version === current.state.version &&
          !principalPolicyStateMatchesReference(current.state, reference),
      )
    )
      throwVerification(
        "hash_mismatch",
        "principal history reference mismatch",
      );
    if (
      current.state.version === input.checkpoint?.version &&
      current.state.stateHash !== input.checkpoint.stateHash
    )
      throwVerification(
        "equivocation",
        "principal history conflicts with the local checkpoint",
      );
    entries.push(current);
    previous = current;
  }
  await verifyPrincipalPolicyChainSignatures({
    chain: entries,
    signerPublicKeyByUserAndFingerprint: signerKeys,
  });
  if (!previous)
    throwVerification("missing_dependency", "principal history page is empty");
  return {
    entries,
    last: previous,
    latestAuthority: authority.latestReference,
  };
}
