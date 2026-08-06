import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
  verifyContainerAccessManifest,
} from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { readCanonicalJson, readCanonicalRecord } from "../keyingCanonicalJson";
import {
  assertCanonicalEqual,
  verifyAccessEventBundle,
} from "./bundleVerification";
import type { ProjectionCheckpointContext } from "./checkpointContext";
import {
  loadManifestCheckpointVerification,
  verifyCachedManifestCheckpoint,
} from "./manifestCheckpointVerification";
import { collectReferencedPrincipalPolicies } from "./principalPolicyVerification";
import { readAccessManifest, readRecordNullableString } from "./readers";
import type {
  PrincipalPolicyCache,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "./types";

export async function verifyContainerManifestBundle(input: {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly enforceLocalCheckpoint: boolean;
  readonly label: string;
  readonly parentPath: readonly VerifiedContainerAccessManifest[];
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash: Map<string, VerifiedContainerAccessManifest>;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): Promise<VerifiedContainerAccessManifest> {
  const parentPath =
    await resolveContainerManifestVerificationParentPath(input);
  const cached = input.verifiedByHash.get(input.bundle.manifestHash);
  if (cached) {
    assertContainerParentPathMatches({
      label: input.label,
      parentPath,
      verifiedManifest: cached,
    });
    if (input.enforceLocalCheckpoint) {
      await verifyCachedManifestCheckpoint({
        current: cached,
        execSql: input.checkpointContext.execSql,
        verifiedManifests: input.verifiedByHash,
      });
    }
    return cached;
  }

  const event = await verifyAccessEventBundle(input);
  const manifest = readAccessManifest(
    input.bundle.manifest,
    `${input.label} manifest`,
  );
  const previousManifest =
    event.event.previousManifestHash === null
      ? null
      : await verifyPreviousContainerManifest({
          ...input,
          parentPath,
          previousManifestHash: event.event.previousManifestHash,
        });
  const referencedPrincipalHeads = [
    ...parentPath.flatMap(
      (parentManifest) => parentManifest.state.referencedPrincipalHeads,
    ),
    ...(previousManifest?.state.referencedPrincipalHeads ?? []),
    ...manifest.referencedPrincipalHeads,
  ];
  const principalPolicies = await collectReferencedPrincipalPolicies({
    checkpointContext: input.checkpointContext,
    organizationId: event.event.organizationId,
    principalPolicyCache: input.principalPolicyCache,
    references: referencedPrincipalHeads,
    resolveUserKey: input.resolveUserKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  const checkpointVerification = input.enforceLocalCheckpoint
    ? await loadManifestCheckpointVerification({
        current: manifest,
        execSql: input.checkpointContext.execSql,
        verifiedManifests: input.verifiedByHash,
      })
    : null;

  const verified = await verifyContainerAccessManifest({
    destinationParentContainerPath: parentPath,
    event,
    expectedManifestHash: input.bundle.manifestHash,
    manifest,
    parentContainerPath: parentPath,
    principalPolicies,
    ...(checkpointVerification ?? {}),
    ...(previousManifest
      ? {
          previousContainerPath: [...parentPath, previousManifest],
          previousManifest,
        }
      : { previousManifest: null }),
  });
  if (!verified.ok) {
    throw new KeyingVerificationError(
      verified.error.code,
      `${input.label} manifest verification failed: ${verified.error.message}`,
    );
  }

  assertCanonicalEqual({
    actual: input.bundle.state,
    expected: readCanonicalJson(verified.value.state, `${input.label} state`),
    label: `${input.label} state`,
  });
  input.verifiedByHash.set(input.bundle.manifestHash, verified.value);

  return verified.value;
}

function assertContainerParentPathMatches(input: {
  readonly label: string;
  readonly parentPath: readonly VerifiedContainerAccessManifest[];
  readonly verifiedManifest: VerifiedContainerAccessManifest;
}): void {
  const actualParentManifestHash =
    input.parentPath.at(-1)?.manifestHash ?? null;
  if (
    actualParentManifestHash !== input.verifiedManifest.state.parentManifestHash
  ) {
    throw new Error(`${input.label} parent path mismatch`);
  }
}

function readContainerManifestParentReference(
  bundle: AccessManifestBundleWireResponse,
  label: string,
): {
  parentContainerId: string | null;
  parentManifestHash: string | null;
} {
  const state = readCanonicalRecord(bundle.state, `${label} state`);

  return {
    parentContainerId: readRecordNullableString(
      state,
      "parentContainerId",
      `${label} state`,
    ),
    parentManifestHash: readRecordNullableString(
      state,
      "parentManifestHash",
      `${label} state`,
    ),
  };
}

async function resolveContainerManifestVerificationParentPath(input: {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly label: string;
  readonly parentPath: readonly VerifiedContainerAccessManifest[];
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash: Map<string, VerifiedContainerAccessManifest>;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): Promise<readonly VerifiedContainerAccessManifest[]> {
  // Descendants keep the parent manifest hash they were created or moved under;
  // a later parent share/rekey must not require rewriting descendant manifests.
  const { parentContainerId, parentManifestHash } =
    readContainerManifestParentReference(input.bundle, input.label);
  if (parentContainerId === null || parentManifestHash === null) {
    return [];
  }

  const parentPathIndex = input.parentPath.findIndex(
    (manifest) =>
      manifest.state.containerId === parentContainerId &&
      manifest.manifestHash === parentManifestHash,
  );
  if (parentPathIndex >= 0) {
    return input.parentPath.slice(0, parentPathIndex + 1);
  }

  const parentBundle = input.bundlesByHash.get(parentManifestHash);
  if (!parentBundle) {
    return input.parentPath;
  }

  const parentParentPath = await resolveContainerManifestVerificationParentPath(
    {
      ...input,
      bundle: parentBundle,
      label: `${input.label} parent manifest`,
    },
  );
  const verifiedParent = await verifyContainerManifestBundle({
    ...input,
    bundle: parentBundle,
    enforceLocalCheckpoint: false,
    label: `${input.label} parent manifest`,
    parentPath: parentParentPath,
  });
  if (verifiedParent.state.containerId !== parentContainerId) {
    throw new Error(`${input.label} parent manifest container mismatch`);
  }

  return [...parentParentPath, verifiedParent];
}

async function verifyPreviousContainerManifest(input: {
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly label: string;
  readonly parentPath: readonly VerifiedContainerAccessManifest[];
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly previousManifestHash: string;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly verifiedByHash: Map<string, VerifiedContainerAccessManifest>;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): Promise<VerifiedContainerAccessManifest> {
  const previousBundle = input.bundlesByHash.get(input.previousManifestHash);
  if (!previousBundle) {
    throw new Error(
      `${input.label} previous manifest ${input.previousManifestHash} is missing`,
    );
  }
  const parentPath = await resolveContainerManifestVerificationParentPath({
    ...input,
    bundle: previousBundle,
  });

  return verifyContainerManifestBundle({
    bundle: previousBundle,
    bundlesByHash: input.bundlesByHash,
    checkpointContext: input.checkpointContext,
    enforceLocalCheckpoint: false,
    label: `${input.label} previous manifest`,
    parentPath,
    principalPolicyCache: input.principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
    verifiedByHash: input.verifiedByHash,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
}
