import {
  type AnyVerifiedPrincipalPolicy,
  KeyingVerificationError,
  principalPolicyMatchesReference,
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
  assertCitedAncestorsDoNotRegress,
  resolveCitedAncestorPath,
} from "./containerAncestorCitations";
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

async function collectManifestAuthorizationPolicies(input: {
  readonly authorizationEvidence: readonly AnyVerifiedPrincipalPolicy[];
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly organizationId: string;
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly referencedPrincipalHeads: Parameters<
    typeof principalPolicyMatchesReference
  >[0]["reference"][];
  readonly requireAuthorizationEvidence: boolean;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}) {
  const missingPrincipalHeads = input.referencedPrincipalHeads.filter(
    (reference) =>
      !input.authorizationEvidence.some((policy) =>
        principalPolicyMatchesReference({ policy, reference }),
      ),
  );
  if (input.requireAuthorizationEvidence && missingPrincipalHeads.length > 0) {
    throw new KeyingVerificationError(
      "missing_dependency",
      "Projection omits required principal policy evidence",
    );
  }
  if (input.requireAuthorizationEvidence)
    return [...input.authorizationEvidence];
  return [
    ...input.authorizationEvidence,
    ...(await collectReferencedPrincipalPolicies({
      checkpointContext: input.checkpointContext,
      organizationId: input.organizationId,
      principalPolicyCache: input.principalPolicyCache,
      references: missingPrincipalHeads,
      resolveUserKey: input.resolveUserKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    })),
  ];
}

export async function verifyContainerManifestBundle(input: {
  readonly authorizationMembership?: "current" | "referenced" | undefined;
  readonly authorizationEvidence?:
    | readonly AnyVerifiedPrincipalPolicy[]
    | undefined;
  readonly bundle: AccessManifestBundleWireResponse;
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly citationDepth?: number | undefined;
  readonly enforceLocalCheckpoint: boolean;
  readonly label: string;
  readonly parentPath: readonly VerifiedContainerAccessManifest[];
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly requireAuthorizationEvidence?: boolean | undefined;
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
  const authorization = await resolveContainerManifestAuthorization(
    input,
    event,
    parentPath,
  );
  const { citedAncestors, previousManifest, sourceAncestors } = authorization;
  const principalPolicies = await collectManifestAuthorizationPolicies({
    authorizationEvidence: input.authorizationEvidence ?? [],
    checkpointContext: input.checkpointContext,
    organizationId: event.event.organizationId,
    principalPolicyCache: input.principalPolicyCache,
    referencedPrincipalHeads: [
      ...authorization.referencedPrincipalHeads,
      ...manifest.referencedPrincipalHeads,
    ],
    requireAuthorizationEvidence: input.requireAuthorizationEvidence ?? false,
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
    authorizationMembership: input.authorizationMembership,
    destinationParentContainerPath: citedAncestors,
    event,
    expectedManifestHash: input.bundle.manifestHash,
    manifest,
    parentContainerPath: citedAncestors,
    principalPolicies,
    ...(checkpointVerification ?? {}),
    ...(previousManifest
      ? {
          previousContainerPath: [...sourceAncestors, previousManifest],
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

type CitedAncestorInput = Parameters<typeof verifyContainerManifestBundle>[0];

/**
 * The paths a container event is authorized against: its previous manifest
 * and the ancestor heads its signed event cites, root to parent.
 */
async function resolveContainerManifestAuthorization(
  input: CitedAncestorInput,
  event: VerifiedContainerAccessManifest["event"],
  parentPath: readonly VerifiedContainerAccessManifest[],
) {
  const previousManifest =
    event.event.previousManifestHash === null
      ? null
      : await verifyPreviousContainerManifest({
          ...input,
          parentPath,
          previousManifestHash: event.event.previousManifestHash,
        });
  // The parent this event leaves the container under comes from signed data:
  // the previous manifest for a grant, revoke, or rekey, and the signed body
  // for a create or move, never from the server-supplied wire state.
  const eventType = event.event.eventType;
  const { parentContainerId, parentManifestHash } =
    previousManifest && eventType !== "container.move"
      ? previousManifest.state
      : readContainerEventBodyParentReference(event, input.label);
  if (
    previousManifest === null &&
    parentManifestHash !== null &&
    !event.event.dependencyManifestHashes.includes(parentManifestHash)
  ) {
    throw new KeyingVerificationError(
      "missing_dependency",
      `${input.label} does not cite the parent manifest it was created under`,
    );
  }
  const citedAncestors = await resolveCitedAncestors(input, event, {
    parentContainerId,
  });
  assertCitedAncestorsDoNotRegress({
    ...citedAncestorResolutionInput(input),
    citedAncestors,
    previousManifest,
  });
  // A move's source path leads to the previous manifest's parent, and the
  // move event cites that path too; the destination path is the one above.
  // The source path is held to the same no-regression rule.
  const sourceAncestors =
    eventType === "container.move" && previousManifest
      ? await resolveCitedAncestors(input, event, {
          parentContainerId: previousManifest.state.parentContainerId,
        })
      : citedAncestors;
  if (sourceAncestors !== citedAncestors) {
    assertCitedAncestorsDoNotRegress({
      ...citedAncestorResolutionInput(input),
      citedAncestors: sourceAncestors,
      previousManifest,
    });
  }
  return {
    citedAncestors,
    previousManifest,
    referencedPrincipalHeads: [
      ...[...parentPath, ...citedAncestors, ...sourceAncestors].flatMap(
        (ancestor) => ancestor.state.referencedPrincipalHeads,
      ),
      ...(previousManifest?.state.referencedPrincipalHeads ?? []),
    ],
    sourceAncestors,
  };
}

// Cited ancestors resolve recursively (an ancestor's own citations), so bound
// the depth against served bundles that cite each other.
const MAX_CITED_ANCESTRY_DEPTH = 100;

function citedAncestorResolutionInput(input: CitedAncestorInput) {
  const citationDepth = input.citationDepth ?? 0;
  if (citationDepth > MAX_CITED_ANCESTRY_DEPTH) {
    throw new KeyingVerificationError(
      "object_mismatch",
      `${input.label} cited ancestry exceeds the maximum depth`,
    );
  }
  return {
    bundlesByHash: input.bundlesByHash,
    label: input.label,
    verifiedByHash: input.verifiedByHash,
    // A cited head older than the served one is history: authorize it at the
    // membership it referenced, as the previous manifest is.
    verifyHistoryBundle: (
      bundle: AccessManifestBundleWireResponse,
      label: string,
    ) =>
      verifyContainerManifestBundle({
        ...input,
        authorizationMembership: "referenced",
        bundle,
        citationDepth: citationDepth + 1,
        enforceLocalCheckpoint: false,
        label,
      }),
  };
}

function resolveCitedAncestors(
  input: CitedAncestorInput,
  event: VerifiedContainerAccessManifest["event"],
  reference: { readonly parentContainerId: string | null },
): Promise<VerifiedContainerAccessManifest[]> {
  return resolveCitedAncestorPath({
    ...citedAncestorResolutionInput(input),
    event,
    parentContainerId: reference.parentContainerId,
  });
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

interface ContainerParentReference {
  parentContainerId: string | null;
  parentManifestHash: string | null;
}

function readParentReference(
  value: unknown,
  label: string,
): ContainerParentReference {
  const record = readCanonicalRecord(value, label);

  return {
    parentContainerId: readRecordNullableString(
      record,
      "parentContainerId",
      label,
    ),
    parentManifestHash: readRecordNullableString(
      record,
      "parentManifestHash",
      label,
    ),
  };
}

function readContainerManifestParentReference(
  bundle: AccessManifestBundleWireResponse,
  label: string,
): ContainerParentReference {
  return readParentReference(bundle.state, `${label} state`);
}

/** The parent a create or move body pins, read from the signed body. */
function readContainerEventBodyParentReference(
  event: VerifiedContainerAccessManifest["event"],
  label: string,
): ContainerParentReference {
  return readParentReference(event.body, `${label} event body`);
}

async function resolveContainerManifestVerificationParentPath(input: {
  readonly authorizationEvidence?:
    | readonly AnyVerifiedPrincipalPolicy[]
    | undefined;
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
  readonly authorizationEvidence?:
    | readonly AnyVerifiedPrincipalPolicy[]
    | undefined;
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly checkpointContext: ProjectionCheckpointContext;
  readonly label: string;
  readonly parentPath: readonly VerifiedContainerAccessManifest[];
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly previousManifestHash: string;
  readonly resolveUserKey: ProjectionUserKeyResolver;
  readonly requireAuthorizationEvidence?: boolean | undefined;
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
    authorizationMembership: "referenced",
    authorizationEvidence: input.authorizationEvidence,
    bundle: previousBundle,
    bundlesByHash: input.bundlesByHash,
    checkpointContext: input.checkpointContext,
    enforceLocalCheckpoint: false,
    label: `${input.label} previous manifest`,
    parentPath,
    principalPolicyCache: input.principalPolicyCache,
    resolveUserKey: input.resolveUserKey,
    requireAuthorizationEvidence: input.requireAuthorizationEvidence,
    verifiedByHash: input.verifiedByHash,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
}
