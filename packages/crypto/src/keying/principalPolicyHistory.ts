import type { PrincipalStateExternalAuthority } from "../principalState";
import { normalizeReferencedPrincipalHead } from "./accessEvent";
import {
  normalizeCanonicalJsonValue,
  serializeKeyingCanonicalJson,
} from "./canonical";
import {
  normalizePrincipalHistoryInput,
  verifyPrincipalHistoryCheckpoint,
} from "./principalPolicyHistoryChecks";
import { appendPrincipalHistoryIndex } from "./principalPolicyHistoryIndex";
import { verifyPrincipalHistoryPage } from "./principalPolicyHistoryPage";
import {
  normalizeAuthenticatedPrincipalHistoryProgress,
  type PrincipalHistoryProgress,
} from "./principalPolicyHistoryProgress";
import {
  capturePrincipalHistoryAuthority,
  capturePrincipalHistoryProgressEntry,
} from "./principalPolicyHistoryProgressEntry";
import {
  openPrincipalHistoryProgress,
  ownPrincipalHistoryProgressProtection,
  sealPrincipalHistoryProgress,
} from "./principalPolicyHistoryProgressProtection";
import {
  makeVerifiedPrincipalPolicyHistory,
  type PrincipalPolicyHistoryInput,
  type PrincipalPolicyHistoryPage,
  type PrincipalPolicyHistoryProgressOptions,
  type PrincipalPolicyHistoryVerifier,
  type VerifiedPrincipalPolicyHistory,
} from "./principalPolicyHistoryTypes";
import { principalPolicyStateMatchesReference } from "./principalPolicyReference";
import { runVerifier, throwVerification, toVerificationResult } from "./shared";
import type {
  KeyingVerificationResult,
  NormalizedPrincipalPolicyStateChainEntry,
  ReferencedPrincipalHead,
} from "./types";

class PrincipalPolicyHistoryVerifierImpl
  implements PrincipalPolicyHistoryVerifier
{
  readonly #input: ReturnType<typeof normalizePrincipalHistoryInput>;
  #previous: NormalizedPrincipalPolicyStateChainEntry | undefined;
  #latestAuthority: PrincipalStateExternalAuthority | null = null;
  #checkpointHash: string | undefined;
  #indexFrontier: readonly (string | null)[] = [];
  #indexRootHash: string | null = null;
  readonly #retained = new Map<
    number,
    NormalizedPrincipalPolicyStateChainEntry
  >();
  #appending = false;

  constructor(
    input: PrincipalPolicyHistoryInput,
    progress?: PrincipalHistoryProgress,
  ) {
    this.#input = normalizePrincipalHistoryInput(input);
    if (progress) {
      this.#previous = progress.previous ?? undefined;
      this.#latestAuthority = progress.latestAuthority;
      this.#checkpointHash = progress.checkpointHash ?? undefined;
      this.#indexFrontier = progress.indexFrontier;
      this.#indexRootHash = progress.indexRootHash;
      for (const entry of progress.retained)
        this.#retained.set(entry.state.version, entry);
    }
  }

  getExternalAuthorityReference(): ReferencedPrincipalHead | null {
    return this.#latestAuthority ? { ...this.#latestAuthority } : null;
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
          checkpoint: this.#input.checkpoint,
        });
        const index = await appendPrincipalHistoryIndex(
          this.#indexFrontier,
          verified.entries.map((entry) => entry.state),
        );
        // Verified pages are nonempty; narrow the general index result here.
        if (!index.rootHash)
          throwVerification(
            "invalid_shape",
            "accepted principal history has no index root",
          );
        // Publish only after every check, including the final signature, passes.
        for (const entry of verified.entries) {
          if (entry.state.version === this.#input.checkpoint?.version)
            this.#checkpointHash = entry.state.stateHash;
          if (
            entry.state.version === this.#input.checkpoint?.version ||
            this.#input.references.some(
              (reference) => reference.version === entry.state.version,
            )
          )
            this.#retained.set(entry.state.version, entry);
        }
        this.#previous = verified.last;
        this.#latestAuthority = verified.latestAuthority;
        this.#indexFrontier = index.frontier;
        this.#indexRootHash = index.rootHash;
        return {
          throughVersion: verified.last.state.version,
          indexRootHash: index.rootHash,
          indexNodes: index.nodes,
        };
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

  exportProgress(options: PrincipalPolicyHistoryProgressOptions) {
    return runVerifier(async () => {
      this.#assertIdle();
      // Capture a complete accepted prefix before the first yield. A later
      // append cannot change this snapshot or publish a partial page into it.
      const plaintext = serializeKeyingCanonicalJson(
        normalizeCanonicalJsonValue(
          {
            previous: this.#previous
              ? capturePrincipalHistoryProgressEntry(this.#previous)
              : null,
            latestAuthority: this.#latestAuthority
              ? capturePrincipalHistoryAuthority(this.#latestAuthority)
              : null,
            checkpointHash: this.#checkpointHash ?? null,
            indexFrontier: this.#indexFrontier,
            retained: [...this.#retained.values()].map(
              capturePrincipalHistoryProgressEntry,
            ),
          },
          "principal history progress",
        ),
      );
      return sealPrincipalHistoryProgress(
        plaintext,
        ownPrincipalHistoryProgressProtection(this.#input, options),
      );
    });
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
        !this.#indexRootHash ||
        !principalPolicyStateMatchesReference(previous.state, reference)
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
        indexRootHash: this.#indexRootHash,
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
      return {
        ok: true,
        value: makeVerifiedPrincipalPolicyHistory(owned, this.#latestAuthority),
      };
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
 * Throws KeyingVerificationError for invalid local scope, checkpoint or references.
 */
export function createPrincipalPolicyHistoryVerifier(
  input: PrincipalPolicyHistoryInput,
): PrincipalPolicyHistoryVerifier {
  const verifier = new PrincipalPolicyHistoryVerifierImpl(input);
  return publicVerifier(verifier);
}

function publicVerifier(
  verifier: PrincipalPolicyHistoryVerifierImpl,
): PrincipalPolicyHistoryVerifier {
  return {
    getExternalAuthorityReference: () =>
      verifier.getExternalAuthorityReference(),
    append: (page: PrincipalPolicyHistoryPage) => verifier.append(page),
    finish: (expectedHead: ReferencedPrincipalHead) =>
      verifier.finish(expectedHead),
    exportProgress: (options: PrincipalPolicyHistoryProgressOptions) =>
      verifier.exportProgress(options),
  };
}

/** Restore only progress authenticated by this verifier's own local key. */
export function restorePrincipalPolicyHistoryVerifier(
  input: PrincipalPolicyHistoryInput,
  progress: string,
  protection: PrincipalPolicyHistoryProgressOptions,
): Promise<KeyingVerificationResult<PrincipalPolicyHistoryVerifier>> {
  return runVerifier(async () => {
    const normalized = normalizePrincipalHistoryInput(input);
    const ownedInput: PrincipalPolicyHistoryInput = {
      principalId: normalized.principalId,
      principalType: normalized.principalType,
      localCheckpoint: normalized.checkpoint,
      retainedReferences: normalized.references,
    };
    const decoded = await openPrincipalHistoryProgress(
      progress,
      ownPrincipalHistoryProgressProtection(normalized, protection),
    );
    const authenticated = await normalizeAuthenticatedPrincipalHistoryProgress(
      decoded,
      normalized,
    );
    return publicVerifier(
      new PrincipalPolicyHistoryVerifierImpl(ownedInput, authenticated),
    );
  });
}
