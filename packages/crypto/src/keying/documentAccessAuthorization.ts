import {
  containerAccessLevelRank,
  requireContainerPathLast,
  requireContainerPathUserAccess,
  resolveContainerPathUserAccessLevel,
  resolveHistoricalContainerPathUserAccessLevel,
} from "./containerAccess";
import { throwVerification } from "./shared";
import type {
  AnyVerifiedPrincipalPolicy as Policy,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
} from "./types";

export function requireEventDependency(input: {
  readonly event: VerifiedAccessEvent;
  readonly manifestHash: string;
  readonly label: string;
}): void {
  if (
    !input.event.event.dependencyManifestHashes.includes(input.manifestHash)
  ) {
    throwVerification(
      "missing_dependency",
      `${input.label} manifest hash is not signed as an event dependency`,
    );
  }
}

function requireContainerPathCurrentManifest(input: {
  readonly containerId: string;
  readonly event: VerifiedAccessEvent;
  readonly label: string;
  readonly manifestHash: string;
  readonly organizationId: string;
  readonly path: readonly VerifiedContainerAccessManifest[] | undefined;
}): VerifiedContainerAccessManifest {
  const manifest = requireContainerPathLast(input.path, input.label);

  if (
    manifest.state.containerId !== input.containerId ||
    manifest.manifestHash !== input.manifestHash
  ) {
    throwVerification(
      "missing_dependency",
      `${input.label} path does not end at the signed container manifest`,
    );
  }

  if (manifest.state.organizationId !== input.organizationId) {
    throwVerification(
      "object_mismatch",
      `${input.label} container belongs to the wrong organization`,
    );
  }

  requireEventDependency({
    event: input.event,
    manifestHash: input.manifestHash,
    label: input.label,
  });

  return manifest;
}

export function requireDocumentContainerPathWriteAccess(input: {
  readonly authorizationMembership: "current" | "referenced";
  readonly containerId: string;
  readonly event: VerifiedAccessEvent;
  readonly label: string;
  readonly manifestHash: string;
  readonly organizationId: string;
  readonly path: readonly VerifiedContainerAccessManifest[] | undefined;
  readonly principalPolicies: readonly Policy[];
}): void {
  requireContainerPathCurrentManifest(input);
  requireContainerPathUserAccess({
    membershipAt: input.authorizationMembership,
    label: input.label,
    minimumAccessLevel: "write",
    path: input.path,
    principalPolicies: input.principalPolicies,
    userId: input.event.event.signerUserId,
  });
}

export function requireAnyDocumentLinkedContainerWriteAccess(input: {
  readonly authorizationMembership: "current" | "referenced";
  readonly event: VerifiedAccessEvent;
  readonly label: string;
  readonly linkedContainerIds: readonly string[];
  readonly organizationId: string;
  readonly paths:
    | readonly (readonly VerifiedContainerAccessManifest[])[]
    | undefined;
  readonly principalPolicies: readonly Policy[];
}): void {
  const dependencyManifestHashes = new Set(
    input.event.event.dependencyManifestHashes,
  );
  const linkedContainerIds = new Set(input.linkedContainerIds);

  for (const path of input.paths ?? []) {
    const manifest = path.at(-1);
    if (
      !manifest ||
      !linkedContainerIds.has(manifest.state.containerId) ||
      manifest.state.organizationId !== input.organizationId ||
      !dependencyManifestHashes.has(manifest.manifestHash)
    ) {
      continue;
    }

    const resolveAccessLevel =
      input.authorizationMembership === "referenced"
        ? resolveHistoricalContainerPathUserAccessLevel
        : resolveContainerPathUserAccessLevel;
    const accessLevel = resolveAccessLevel({
      path,
      principalPolicies: input.principalPolicies,
      userId: input.event.event.signerUserId,
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
    `${input.label} signer lacks write access through a signed linked container dependency`,
  );
}
