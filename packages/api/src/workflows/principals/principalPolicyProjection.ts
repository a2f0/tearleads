import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { gatherWithExecutor } from "@tearleads/api-shared/postgres";
import type {
  PrincipalPolicyAuthorization,
  ReferencedPrincipalHead,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { principalPolicyMatchesReference } from "@tearleads/crypto";
import {
  getCurrentPrincipalStates,
  principalStateReferenceKey,
} from "../../access/read/principalStateStore";
import { loadPrincipalPolicyReferenceBatches } from "./principalPolicyReferenceBatches";
import { loadPrincipalPolicySelections } from "./principalPolicySelections";
import { PrincipalPolicyError, PrincipalPolicyReferenceError } from "./shared";

export class PrincipalPolicyProjectionError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "PrincipalPolicyProjectionError";
  }
}

function principalIdentityKey(input: {
  readonly principalId: string;
  readonly principalType: string;
}): string {
  return `${input.principalType}:${input.principalId}`;
}

function collectReferencedPrincipalHeads(
  paths: readonly (readonly VerifiedContainerAccessManifest[])[],
): ReferencedPrincipalHead[] {
  const headsByReference = new Map<string, ReferencedPrincipalHead>();

  for (const path of paths) {
    for (const manifest of path) {
      for (const principalHead of manifest.state.referencedPrincipalHeads) {
        headsByReference.set(principalStateReferenceKey(principalHead), {
          ...principalHead,
        });
      }
    }
  }

  return Array.from(headsByReference.values()).sort((left, right) =>
    principalStateReferenceKey(left).localeCompare(
      principalStateReferenceKey(right),
    ),
  );
}

function dedupeReferencedPrincipalHeads(
  references: readonly ReferencedPrincipalHead[],
): ReferencedPrincipalHead[] {
  const headsByReference = new Map<string, ReferencedPrincipalHead>();
  for (const reference of references) {
    headsByReference.set(principalStateReferenceKey(reference), {
      ...reference,
    });
  }
  return Array.from(headsByReference.values()).sort((left, right) =>
    principalStateReferenceKey(left).localeCompare(
      principalStateReferenceKey(right),
    ),
  );
}

export async function loadPrincipalPoliciesForContainerPaths(
  executor: DatabaseSession,
  paths: readonly (readonly VerifiedContainerAccessManifest[])[],
  evidence: readonly PrincipalPolicyAuthorization[] = [],
): Promise<PrincipalPolicyAuthorization[]> {
  const missing = collectReferencedPrincipalHeads(paths).filter(
    (reference) =>
      !evidence.some((policy) =>
        principalPolicyMatchesReference({ policy, reference }),
      ),
  );
  return [
    ...evidence,
    ...(await loadPrincipalPoliciesForReferences(executor, missing)),
  ];
}

export async function loadPrincipalAuthorizationPoliciesForReferences(
  executor: DatabaseSession,
  references: readonly ReferencedPrincipalHead[],
  evidence: readonly PrincipalPolicyAuthorization[],
): Promise<PrincipalPolicyAuthorization[]> {
  const missing = references.filter(
    (reference) =>
      !evidence.some((policy) =>
        principalPolicyMatchesReference({ policy, reference }),
      ),
  );
  if (missing.length === 0) return [...evidence];
  try {
    const policies = await loadPrincipalPolicySelections(executor, missing);
    return [...evidence, ...policies];
  } catch (error) {
    if (error instanceof PrincipalPolicyError) {
      throw new PrincipalPolicyProjectionError(
        `Principal policy failed integrity verification: ${error.message}`,
      );
    }
    throw error;
  }
}

export async function loadPrincipalAuthorizationPoliciesForContainerPaths(
  executor: DatabaseSession,
  paths: readonly (readonly VerifiedContainerAccessManifest[])[],
  evidence: readonly PrincipalPolicyAuthorization[],
): Promise<PrincipalPolicyAuthorization[]> {
  return loadPrincipalAuthorizationPoliciesForReferences(
    executor,
    collectReferencedPrincipalHeads(paths),
    evidence,
  );
}

async function loadPrincipalPoliciesForReferences(
  executor: DatabaseSession,
  references: readonly ReferencedPrincipalHead[],
): Promise<PrincipalPolicyAuthorization[]> {
  const referencedPrincipalHeads = dedupeReferencedPrincipalHeads(references);

  if (referencedPrincipalHeads.length === 0) {
    return [];
  }

  const policies: PrincipalPolicyAuthorization[] = [];

  for (const principalType of [
    ...new Set(
      referencedPrincipalHeads.map((reference) => reference.principalType),
    ),
  ]) {
    const referencesForType = referencedPrincipalHeads.filter(
      (reference) => reference.principalType === principalType,
    );
    const currentStates = await getCurrentPrincipalStates(
      principalType,
      referencesForType.map((reference) => reference.principalId),
      executor,
    );

    for (const reference of referencesForType) {
      if (!currentStates.has(reference.principalId)) {
        throw new PrincipalPolicyProjectionError(
          "Principal policy state is stale",
        );
      }
    }

    const resolvedPolicies = await gatherWithExecutor(
      executor,
      Array.from(currentStates.values()),
      async (currentState) => {
        const referencesForPrincipal = referencesForType.filter(
          (reference) =>
            principalIdentityKey(reference) ===
            principalIdentityKey(currentState),
        );
        try {
          const batches = await loadPrincipalPolicyReferenceBatches(
            executor,
            currentState,
            referencesForPrincipal,
          );
          return batches.map(({ policy }) => policy);
        } catch (error) {
          if (error instanceof PrincipalPolicyReferenceError)
            throw new PrincipalPolicyProjectionError(error.message);
          if (error instanceof PrincipalPolicyError) {
            throw new PrincipalPolicyProjectionError(
              `Principal policy failed integrity verification: ${error.message}`,
            );
          }
          throw error;
        }
      },
    );

    policies.push(...resolvedPolicies.flat());
  }

  return policies.sort((left, right) =>
    principalStateReferenceKey(left).localeCompare(
      principalStateReferenceKey(right),
    ),
  );
}
