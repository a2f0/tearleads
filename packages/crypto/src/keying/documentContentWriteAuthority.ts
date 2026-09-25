import {
  containerAccessLevelRank,
  resolveContainerPathUserAccessLevel,
} from "./containerAccess";
import { resolveHistoricalContainerPathUserAccessLevel } from "./containerPathAccess";
import { assertDocumentCitationScope } from "./documentCitationScope";
import { throwVerification } from "./shared";
import type {
  AnyVerifiedPrincipalPolicy as Policy,
  VerifiedBlobKekTargets,
  VerifiedContainerAccessManifest,
  VerifiedDocumentKekTargets,
  VerifiedDocumentLinkSetManifest,
  WriteHeader,
} from "./types";

export function requireWriteAccessThroughCommittedDocumentTarget(input: {
  readonly authorizationMembership?: "current" | "referenced";
  readonly documentKekTargets: VerifiedDocumentKekTargets;
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly label: string;
  readonly paths: readonly (readonly VerifiedContainerAccessManifest[])[];
  readonly principalPolicies: readonly Policy[];
  readonly userId: string;
}): void {
  assertDocumentCitationScope({
    label: input.label,
    linkedContainerIds: input.documentManifest.state.linkedContainerIds,
    leafManifestHashes: new Set(
      input.documentKekTargets.targets.map(
        (target) => target.containerManifestHash,
      ),
    ),
    organizationId: input.documentManifest.state.organizationId,
    paths: input.paths,
  });
  const targetHashByContainerId = new Map(
    input.documentKekTargets.targets.map((target) => [
      target.containerId,
      target.containerManifestHash,
    ]),
  );
  const linkedContainerIds = new Set(
    input.documentManifest.state.linkedContainerIds,
  );

  for (const path of input.paths) {
    const manifest = path.at(-1);
    if (
      !manifest ||
      !linkedContainerIds.has(manifest.state.containerId) ||
      manifest.state.organizationId !==
        input.documentManifest.state.organizationId ||
      targetHashByContainerId.get(manifest.state.containerId) !==
        manifest.manifestHash
    ) {
      continue;
    }

    const resolveAccess =
      input.authorizationMembership === "referenced"
        ? resolveHistoricalContainerPathUserAccessLevel
        : resolveContainerPathUserAccessLevel;
    const accessLevel = resolveAccess({
      path,
      principalPolicies: input.principalPolicies,
      userId: input.userId,
    });

    if (
      accessLevel !== null &&
      containerAccessLevelRank(accessLevel) >= containerAccessLevelRank("write")
    ) {
      return;
    }
  }

  throwVerification(
    "unauthorized",
    `${input.label} signer lacks write access through a committed linked container target`,
  );
}

export function requireWriteAccessThroughCommittedBlobTarget(input: {
  readonly authorizationMembership?: "current" | "referenced";
  readonly blobKekTargets: VerifiedBlobKekTargets;
  readonly header: WriteHeader;
  readonly label: string;
  readonly paths: readonly (readonly VerifiedContainerAccessManifest[])[];
  readonly principalPolicies: readonly Policy[];
}): void {
  assertDocumentCitationScope({
    label: input.label,
    linkedContainerIds: input.blobKekTargets.targets.map(
      (target) => target.containerId,
    ),
    leafManifestHashes: new Set(
      input.blobKekTargets.targets.map(
        (target) => target.containerManifestHash,
      ),
    ),
    organizationId: input.header.organizationId,
    paths: input.paths,
  });
  const targetManifestHashesByContainerId = new Map<string, Set<string>>();

  for (const target of input.blobKekTargets.targets) {
    const manifestHashes =
      targetManifestHashesByContainerId.get(target.containerId) ?? new Set();
    manifestHashes.add(target.containerManifestHash);
    targetManifestHashesByContainerId.set(target.containerId, manifestHashes);
  }

  for (const path of input.paths) {
    const manifest = path.at(-1);
    if (
      !manifest ||
      manifest.state.organizationId !== input.header.organizationId ||
      !targetManifestHashesByContainerId
        .get(manifest.state.containerId)
        ?.has(manifest.manifestHash)
    ) {
      continue;
    }

    const resolveAccess =
      input.authorizationMembership === "referenced"
        ? resolveHistoricalContainerPathUserAccessLevel
        : resolveContainerPathUserAccessLevel;
    const accessLevel = resolveAccess({
      path,
      principalPolicies: input.principalPolicies,
      userId: input.header.writerUserId,
    });

    if (
      accessLevel !== null &&
      containerAccessLevelRank(accessLevel) >= containerAccessLevelRank("write")
    ) {
      return;
    }
  }

  throwVerification(
    "unauthorized",
    `${input.label} signer lacks write access through a committed blob target`,
  );
}
