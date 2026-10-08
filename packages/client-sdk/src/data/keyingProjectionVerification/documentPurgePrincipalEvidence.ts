import {
  KeyingVerificationError,
  type PrincipalPolicyAuthorization,
  principalPolicyMatchesReference,
  type ReferencedPrincipalHead,
  type VerifiedContainerAccessManifest,
  type VerifiedDocumentLinkSetManifest,
  type VerifiedDocumentLinkSetSnapshot,
  type VerifiedPrincipalPolicySelection,
  verifyDocumentPurgeEvent,
} from "@tearleads/crypto";
import type { DocumentPurgeProofResponse } from "@tearleads/validators/response";
import { parseOrganizationAuthorityDescriptor } from "../principals/organizationAuthorityDescriptor";
import { verifyStandaloneAccessEventBundle } from "./bundleVerification";
import type { ProjectionCheckpointContext } from "./checkpointContext";
import { verifyPurgeDocumentManifest } from "./documentPurgeDocumentChainVerification";
import type { PrincipalPolicyCache, ProjectionUserKeyResolver } from "./types";

function principalIdentity(input: {
  readonly principalId: string;
  readonly principalType: string;
}): string {
  return `${input.principalType}:${input.principalId}`;
}

function collectEvidenceContainerManifests(input: {
  readonly roots: readonly VerifiedContainerAccessManifest[];
  readonly verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): VerifiedContainerAccessManifest[] {
  const selected = new Map<string, VerifiedContainerAccessManifest>();
  const pending = [...input.roots];
  while (pending.length > 0) {
    const manifest = pending.shift();
    if (!manifest || selected.has(manifest.manifestHash)) continue;
    selected.set(manifest.manifestHash, manifest);
    for (const dependencyHash of [
      manifest.manifest.previousManifestHash,
      manifest.state.parentManifestHash,
    ]) {
      if (!dependencyHash) continue;
      const dependency = input.verifiedByHash.get(dependencyHash);
      if (dependency) pending.push(dependency);
    }
  }
  return [...selected.values()];
}

function requireExactPurgePrincipalEvidence<
  TPolicy extends PrincipalPolicyAuthorization,
>(input: {
  readonly authorizationEvidence: readonly TPolicy[];
  readonly verifiedContainerManifests: readonly VerifiedContainerAccessManifest[];
  readonly policyEvidence: DocumentPurgeProofResponse["policyEvidence"];
}): TPolicy[] {
  const references: ReferencedPrincipalHead[] =
    input.verifiedContainerManifests.flatMap(
      (manifest) => manifest.state.referencedPrincipalHeads,
    );
  const requiredByPrincipal = new Set<string>();

  for (const reference of references) {
    const policy = input.authorizationEvidence.find((candidate) =>
      principalPolicyMatchesReference({ policy: candidate, reference }),
    );
    if (!policy) {
      throw new KeyingVerificationError(
        "missing_dependency",
        "Document purge proof omits referenced principal policy evidence",
      );
    }
    const identity = principalIdentity(policy);
    requiredByPrincipal.add(identity);
    // External authority is verified incrementally by paged recovery. Its
    // historical entries need not be copied into this returned selection.
  }

  const allowed = new Set(requiredByPrincipal);
  // Paged recovery has authenticated these payloads against their signed
  // organization states and verified their exact group-head bindings. This
  // identity allow-list cannot authenticate an unverified directory payload.
  for (const { payload } of input.policyEvidence.organizationPayloads) {
    const directory = parseOrganizationAuthorityDescriptor(payload.ciphertext);
    if (
      directory.groupHeads.some((head) => allowed.has(principalIdentity(head)))
    ) {
      allowed.add(`group:${directory.adminGroupId}`);
      allowed.add(`organization:${directory.organizationId}`);
    }
  }
  if (
    input.authorizationEvidence.some(
      (policy) => !allowed.has(principalIdentity(policy)),
    )
  )
    throw new KeyingVerificationError(
      "invalid_shape",
      "Document purge proof includes unrelated principal policy evidence",
    );
  return input.authorizationEvidence.filter((policy) =>
    requiredByPrincipal.has(principalIdentity(policy)),
  );
}

async function authenticateDocumentPurgeEvent(input: {
  readonly authorizationEvidence: readonly VerifiedPrincipalPolicySelection[];
  readonly authorizingContainerPath: readonly VerifiedContainerAccessManifest[];
  readonly documentManifest:
    | VerifiedDocumentLinkSetManifest
    | VerifiedDocumentLinkSetSnapshot;
  readonly expectedDocumentId: string;
  readonly purgeEvent: DocumentPurgeProofResponse["purgeEvent"];
  readonly policyEvidence: DocumentPurgeProofResponse["policyEvidence"];
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly rootContainerManifests: readonly VerifiedContainerAccessManifest[];
  readonly verifiedContainerManifests: ReadonlyMap<
    string,
    VerifiedContainerAccessManifest
  >;
}): Promise<{
  readonly principalPolicies: VerifiedPrincipalPolicySelection[];
  readonly purgeEventHash: string;
}> {
  const event = await verifyStandaloneAccessEventBundle({
    bundle: input.purgeEvent,
    label: "Document purge event",
    resolveUserKey: input.resolveUserKey,
  });
  const evidenceContainerManifests = collectEvidenceContainerManifests({
    roots: input.rootContainerManifests,
    verifiedByHash: input.verifiedContainerManifests,
  });
  const principalPolicies = requireExactPurgePrincipalEvidence({
    authorizationEvidence: input.authorizationEvidence,
    verifiedContainerManifests: evidenceContainerManifests,
    policyEvidence: input.policyEvidence,
  });
  const verified = await verifyDocumentPurgeEvent({
    authorizingContainerPath: input.authorizingContainerPath,
    documentManifest: input.documentManifest,
    event,
    expectedDocumentId: input.expectedDocumentId,
    principalPolicies,
  });
  if (!verified.ok) throw verified.error;
  return {
    principalPolicies: [...input.authorizationEvidence],
    purgeEventHash: verified.value.eventHash,
  };
}

export async function authenticateDocumentPurgeArtifacts(input: {
  readonly authorizationEvidence: readonly VerifiedPrincipalPolicySelection[];
  readonly authorizingContainerPath: readonly VerifiedContainerAccessManifest[];
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly containerPathByManifestHash: ReadonlyMap<
    string,
    readonly VerifiedContainerAccessManifest[]
  >;
  readonly enforceLocalCheckpoints: boolean;
  readonly expectedDocumentId: string;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly proof: DocumentPurgeProofResponse;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedContainerManifests: ReadonlyMap<
    string,
    VerifiedContainerAccessManifest
  >;
}) {
  const usedContainerManifests = new Map<
    string,
    VerifiedContainerAccessManifest
  >();
  const documentManifest = await verifyPurgeDocumentManifest({
    authorizationEvidence: input.authorizationEvidence,
    checkpointContext: input.checkpointContext,
    containerPathByManifestHash: input.containerPathByManifestHash,
    enforceLocalCheckpoints: input.enforceLocalCheckpoints,
    principalPolicyCache: input.principalPolicyCache,
    proof: input.proof,
    resolveUserKey: input.resolveUserKey,
    usedContainerManifests,
  });
  return {
    documentManifest,
    ...(await authenticateDocumentPurgeEvent({
      authorizationEvidence: input.authorizationEvidence,
      authorizingContainerPath: input.authorizingContainerPath,
      documentManifest,
      expectedDocumentId: input.expectedDocumentId,
      purgeEvent: input.proof.purgeEvent,
      policyEvidence: input.proof.policyEvidence,
      resolveUserKey: input.resolveUserKey,
      rootContainerManifests: [
        ...input.authorizingContainerPath,
        ...usedContainerManifests.values(),
      ],
      verifiedContainerManifests: input.verifiedContainerManifests,
    })),
  };
}
