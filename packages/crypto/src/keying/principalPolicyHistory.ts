import type { PrincipalStateExternalAuthority } from "../principalState";
import { normalizeReferencedPrincipalHead } from "./accessEvent";
import {
  normalizePrincipalHistoryInput,
  principalHistoryMatchesReference,
  verifyPrincipalHistoryCheckpoint,
} from "./principalPolicyHistoryChecks";
import { verifyPrincipalHistoryPage } from "./principalPolicyHistoryPage";
import type {
  PrincipalPolicyHistoryInput,
  PrincipalPolicyHistoryPage,
  VerifiedPrincipalPolicyHistory,
} from "./principalPolicyHistoryTypes";
import { runVerifier, throwVerification, toVerificationResult } from "./shared";
import type {
  KeyingVerificationResult,
  NormalizedPrincipalPolicyStateChainEntry,
  ReferencedPrincipalHead,
} from "./types";

class PrincipalPolicyHistoryVerifier {
  readonly #input: ReturnType<typeof normalizePrincipalHistoryInput>;
  #previous: NormalizedPrincipalPolicyStateChainEntry | undefined;
  #latestAuthority: PrincipalStateExternalAuthority | null = null;
  #checkpointHash: string | undefined;
  readonly #retained = new Map<
    number,
    NormalizedPrincipalPolicyStateChainEntry
  >();
  #appending = false;

  constructor(input: PrincipalPolicyHistoryInput) {
    this.#input = normalizePrincipalHistoryInput(input);
  }

  append(page: PrincipalPolicyHistoryPage) {
    return runVerifier(async () => {
      this.#assertIdle();
      this.#appending = true;
      try {
        const verified = await verifyPrincipalHistoryPage({
          page,
          principalId: this.#input.principalId,
          principalType: this.#input.principalType,
          previous: this.#previous,
          latestAuthority: this.#latestAuthority,
          references: this.#input.references,
        });
        // Publish only after every check, including the final signature, passes.
        for (const entry of verified.entries) {
          if (entry.state.version === this.#input.checkpoint?.version)
            this.#checkpointHash = entry.state.stateHash;
          if (
            this.#input.references.some(
              (reference) => reference.version === entry.state.version,
            )
          )
            this.#retained.set(entry.state.version, entry);
        }
        this.#previous = verified.last;
        this.#latestAuthority = verified.latestAuthority;
        return { throughVersion: verified.last.state.version };
      } finally {
        this.#appending = false;
      }
    });
  }

  #assertIdle(): void {
    if (this.#appending)
      throwVerification(
        "invalid_shape",
        "principal history append in progress",
      );
  }

  finish(
    expectedHead: ReferencedPrincipalHead,
  ): KeyingVerificationResult<VerifiedPrincipalPolicyHistory> {
    try {
      this.#assertIdle();
      const reference = normalizeReferencedPrincipalHead(expectedHead);
      const previous = this.#previous;
      if (
        !previous ||
        !principalHistoryMatchesReference(previous.state, reference)
      )
        throwVerification(
          "missing_dependency",
          "principal history has not reached the requested head",
        );
      verifyPrincipalHistoryCheckpoint(
        previous.state,
        this.#input.checkpoint,
        this.#checkpointHash,
      );
      const history = new Map(this.#retained);
      history.set(previous.state.version, previous);
      const { state, projection, grants } = previous;
      const { principalId, principalType } = this.#input;
      const owned = structuredClone({
        currentEntry: { state, projection, grants },
        retainedEntries: [...history.values()].sort(
          (left, right) => left.state.version - right.state.version,
        ),
        checkpoint: {
          principalId,
          principalType,
          version: state.version,
          stateHash: state.stateHash,
        },
      });
      return { ok: true, value: owned };
    } catch (error) {
      return toVerificationResult(error);
    }
  }
}

/**
 * Verify from genesis with bounded retained state. A rejected page cannot
 * advance authorization or continuity. Progress is local to this verifier;
 * a remote cursor/checkpoint is never accepted as verified history.
 * Callers bound serialized page bytes and authenticate external authority.
 */
export function createPrincipalPolicyHistoryVerifier(
  input: PrincipalPolicyHistoryInput,
) {
  const verifier = new PrincipalPolicyHistoryVerifier(input);
  return {
    append: (page: PrincipalPolicyHistoryPage) => verifier.append(page),
    finish: (expectedHead: ReferencedPrincipalHead) =>
      verifier.finish(expectedHead),
  };
}
