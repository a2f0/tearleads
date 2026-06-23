import type {
  AccessEvent,
  AccessManifest,
  ContainerAccessManifestState,
  ContainerDirectGrant,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerRevokeAccessEventBody,
  ContainerUserRecipientKey,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import type {
  ContainerKekResponse,
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  buildContainerCreateKeyEpoch,
  resolveContainerKekEpochId,
  signContainerMutationEvent,
} from "../../../data/containers/shared/events";
import {
  principalPolicyRequestRecord,
  uniquePrincipalPolicies,
} from "../../../data/containers/shared/principalPolicies";
import {
  asContainerManifestBundle,
  getParentKekForTarget,
  getTargetContainerContext,
  readContainerState,
  uniqueSortedManifestHashes,
  wrapContainerKeyToManagedPrincipal,
  wrapContainerKeyToParent,
  wrapContainerKeyToRootUser,
} from "../../../data/containers/shared/projection";
import type {
  ContainerMutationAuthor,
  ContainerRevokeApi,
  ContainerRevokePlan,
  MaterializedContainerRevokePlan,
} from "../../../data/containers/shared/types";
import { unwrapContainerKekPath } from "../../../data/documents/shared/projection";
import {
  type ProjectionVerificationOptions,
  projectionVerificationOptions,
} from "../../../data/documents/shared/types";
import {
  readCanonicalRecord,
  readCanonicalRecords,
} from "../../../data/keyingCanonicalJson";
import {
  collectContainerWriterProjectionPrincipalPolicies,
  type ProjectionUserKeyResolver,
  requireProjectionUserKeyResolver,
} from "../../../data/keyingProjectionVerification";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type ContainerRevokeSubject,
  deriveContainerRevokeManifest,
} from "./revokeManifest";

function buildContainerRevokeRequest(input: {
  body: ContainerRevokeAccessEventBody;
  event: AccessEvent;
  keyEpoch: ContainerKeyEpoch;
  manifest: AccessManifest;
  manifestHash: string;
  parentKek: ContainerKekResponse | null;
  previousManifest: AccessManifestBundleWire;
  previousProjection: ContainerWriterProjectionResponse;
  principalPolicies: readonly VerifiedPrincipalPolicy[];
  userRecipientKeys: readonly ContainerUserRecipientKey[];
  wraps: readonly ContainerKeyWrap[];
}): ContainerMutationRequest {
  return {
    event: readCanonicalRecord(input.event, "Container revoke event"),
    body: readCanonicalRecord(input.body, "Container revoke body"),
    expectedManifestHash: input.manifestHash,
    manifest: readCanonicalRecord(input.manifest, "Container revoke manifest"),
    previousManifest: input.previousManifest,
    previousContainerPath: input.previousProjection.path.map(
      asContainerManifestBundle,
    ),
    principalPolicies: readCanonicalRecords(
      input.principalPolicies.map((policy) =>
        principalPolicyRequestRecord(policy),
      ),
      "Container revoke principal policies",
    ),
    keyEpoch: readCanonicalRecord(input.keyEpoch, "Container revoke key epoch"),
    wraps: readCanonicalRecords(input.wraps, "Container revoke wraps"),
    parentKekState:
      input.parentKek === null
        ? null
        : readCanonicalRecord(
            input.parentKek,
            "Container revoke parent KEK state",
          ),
    userRecipientKeys: readCanonicalRecords(
      input.userRecipientKeys,
      "Container revoke user recipient keys",
    ),
  };
}

function findPrincipalPolicy(input: {
  principalPolicies: readonly VerifiedPrincipalPolicy[];
  reference: ReferencedPrincipalHead;
}): VerifiedPrincipalPolicy {
  const policy = input.principalPolicies.find(
    (candidate) =>
      candidate.principalType === input.reference.principalType &&
      candidate.principalId === input.reference.principalId &&
      candidate.version === input.reference.version &&
      candidate.keyEpoch === input.reference.keyEpoch &&
      candidate.stateHash === input.reference.stateHash,
  );
  if (!policy) {
    throw new Error("Container revoke principal policy is missing");
  }

  return policy;
}

function referenceForManagedGrant(input: {
  grant: ContainerDirectGrant;
  state: ContainerAccessManifestState;
}): ReferencedPrincipalHead {
  const reference = input.state.referencedPrincipalHeads.find(
    (candidate) =>
      candidate.principalType === input.grant.subjectType &&
      candidate.principalId === input.grant.subjectId,
  );
  if (!reference) {
    throw new Error("Container revoke referenced principal head is missing");
  }

  return reference;
}

async function buildRevocationWraps(input: {
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  manifestHash: string;
  parentKek: ContainerKekResponse | null;
  parentKekMaterial: Uint8Array | null;
  principalPolicies: readonly VerifiedPrincipalPolicy[];
  resolveUserKey: ProjectionUserKeyResolver;
  state: ContainerAccessManifestState;
}): Promise<{
  readonly userRecipientKeys: ContainerUserRecipientKey[];
  readonly wraps: ContainerKeyWrap[];
}> {
  const userRecipientKeys: ContainerUserRecipientKey[] = [];
  const wraps: ContainerKeyWrap[] = [];

  if (input.parentKek) {
    if (!input.parentKekMaterial) {
      throw new Error("Container revoke parent KEK could not be unwrapped");
    }

    wraps.push(
      await wrapContainerKeyToParent({
        containerKey: input.containerKey,
        containerKeyEpochId: input.containerKeyEpochId,
        manifestHash: input.manifestHash,
        parentKek: input.parentKek,
        parentKekMaterial: input.parentKekMaterial,
      }),
    );
  }

  for (const grant of input.state.directGrants) {
    if (grant.subjectType === "user") {
      const userKey = await input.resolveUserKey(grant.subjectId);
      if (!userKey) {
        throw new Error(
          `Container revoke recipient key is missing for direct user grant ${grant.subjectId}`,
        );
      }

      const recipient = await wrapContainerKeyToRootUser({
        containerKey: input.containerKey,
        containerKeyEpochId: input.containerKeyEpochId,
        manifestHash: input.manifestHash,
        recipientEncapsulationPublicKey: userKey.encapsulationPublicKey,
        userId: grant.subjectId,
      });
      userRecipientKeys.push(recipient.userRecipientKey);
      wraps.push(recipient.wrap);
      continue;
    }

    const reference = referenceForManagedGrant({ grant, state: input.state });
    const policy = findPrincipalPolicy({
      principalPolicies: input.principalPolicies,
      reference,
    });
    const recipient = await wrapContainerKeyToManagedPrincipal({
      containerKey: input.containerKey,
      containerKeyEpochId: input.containerKeyEpochId,
      manifestHash: input.manifestHash,
      principalEncapsulationPublicKey: policy.state.encapsulationPublicKey,
      principalHead: reference,
    });
    wraps.push(recipient.wrap);
  }

  return {
    userRecipientKeys: userRecipientKeys.sort((left, right) =>
      left.userId.localeCompare(right.userId),
    ),
    wraps: wraps.sort((left, right) =>
      `${left.recipientKind}:${left.recipientId}`.localeCompare(
        `${right.recipientKind}:${right.recipientId}`,
      ),
    ),
  };
}

async function collectContainerRevokePrincipalPolicies(input: {
  execSql?: ExecSql | undefined;
  previousProjection: ContainerWriterProjectionResponse;
  resolveUserKey: ProjectionUserKeyResolver;
}): Promise<VerifiedPrincipalPolicy[]> {
  return uniquePrincipalPolicies(
    await collectContainerWriterProjectionPrincipalPolicies({
      execSql: input.execSql,
      projection: input.previousProjection,
      resolveUserKey: input.resolveUserKey,
    }),
  );
}

function buildContainerRevokePlanResult(input: {
  body: ContainerRevokeAccessEventBody;
  containerId: string;
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  event: AccessEvent;
  eventHash: string;
  keyEpoch: ContainerKeyEpoch;
  manifest: AccessManifest;
  manifestHash: string;
  parentKek: ContainerKekResponse | null;
  previousManifest: AccessManifestBundleWire;
  previousProjection: ContainerWriterProjectionResponse;
  principalPolicies: readonly VerifiedPrincipalPolicy[];
  state: ContainerAccessManifestState;
  userRecipientKeys: ContainerUserRecipientKey[];
  wraps: ContainerKeyWrap[];
}): MaterializedContainerRevokePlan {
  const plan: ContainerRevokePlan = {
    body: input.body,
    containerId: input.containerId,
    containerKeyEpochId: input.containerKeyEpochId,
    event: input.event,
    eventHash: input.eventHash,
    keyEpoch: input.keyEpoch,
    manifest: input.manifest,
    manifestHash: input.manifestHash,
    previousManifest: input.previousManifest,
    request: buildContainerRevokeRequest({
      body: input.body,
      event: input.event,
      keyEpoch: input.keyEpoch,
      manifest: input.manifest,
      manifestHash: input.manifestHash,
      parentKek: input.parentKek,
      previousManifest: input.previousManifest,
      previousProjection: input.previousProjection,
      principalPolicies: input.principalPolicies,
      userRecipientKeys: input.userRecipientKeys,
      wraps: input.wraps,
    }),
    state: input.state,
    userRecipientKeys: input.userRecipientKeys,
    wraps: input.wraps,
  };

  return { containerKey: input.containerKey, plan };
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Revoke planning has to keep the manifest, KEK, wraps, and signed event in one auditable transition.
export async function buildMaterializedContainerRevokePlan(
  input: {
    author: ContainerMutationAuthor;
    containerKey?: Uint8Array | undefined;
    containerKeyEpochId?: string | undefined;
    eventId?: string | undefined;
    execSql?: ExecSql | undefined;
    previousProjection: ContainerWriterProjectionResponse;
    revokedSubject: ContainerRevokeSubject;
    signedAt?: string | undefined;
    targetSecretKey: Uint8Array;
  } & ProjectionVerificationOptions,
): Promise<MaterializedContainerRevokePlan> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote container revoke",
  );
  const containerKey =
    input.containerKey ?? crypto.getRandomValues(new Uint8Array(32));
  if (containerKey.byteLength !== 32) {
    throw new Error("Container KEK material must be 32 bytes");
  }

  const keksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    projection: input.previousProjection,
    secretKey: input.targetSecretKey,
    ...projectionVerificationOptions(input),
  });
  const target = getTargetContainerContext(input.previousProjection);
  const previousState = readContainerState(target.manifest);
  if (previousState.organizationId !== input.author.organizationId) {
    throw new Error("Container revoke author organization mismatch");
  }

  const parentKek = getParentKekForTarget(input.previousProjection);
  const parentKekMaterial = parentKek
    ? (keksByEpochId.get(parentKek.containerKeyEpochId) ?? null)
    : null;
  const nextContainerKeyEpoch = target.kek.containerKeyEpoch + 1;
  const containerKeyEpochId = await resolveContainerKekEpochId({
    containerId: previousState.containerId,
    keyEpoch: nextContainerKeyEpoch,
    keyMaterial: containerKey,
    override: input.containerKeyEpochId,
  });
  const body: ContainerRevokeAccessEventBody = {
    eventType: "container.revoke",
    containerKeyEpochId,
    subjectId: input.revokedSubject.subjectId,
    subjectType: input.revokedSubject.subjectType,
  };
  const { event, eventHash } = await signContainerMutationEvent({
    author: input.author,
    body,
    containerId: previousState.containerId,
    dependencyManifestHashes: uniqueSortedManifestHashes(
      input.previousProjection.path,
    ),
    eventId: input.eventId ?? crypto.randomUUID(),
    previousManifestHash: target.manifest.manifestHash,
    signedAt: input.signedAt ?? new Date().toISOString(),
  });
  const { manifest, manifestHash, state } = await deriveContainerRevokeManifest(
    {
      containerKeyEpochId,
      eventHash,
      previousManifest: target.manifest,
      revokedSubject: input.revokedSubject,
    },
  );
  const keyEpoch = buildContainerCreateKeyEpoch({
    containerId: previousState.containerId,
    containerKeyEpochId,
    eventHash,
    manifestHash,
    parentContainerKeyEpochId: parentKek?.containerKeyEpochId ?? null,
  });
  keyEpoch.keyEpoch = nextContainerKeyEpoch;
  const principalPolicies = await collectContainerRevokePrincipalPolicies({
    execSql: input.execSql,
    previousProjection: input.previousProjection,
    resolveUserKey: resolveProjectionUserKey,
  });
  const { userRecipientKeys, wraps } = await buildRevocationWraps({
    containerKey,
    containerKeyEpochId,
    manifestHash,
    parentKek,
    parentKekMaterial,
    principalPolicies,
    resolveUserKey: resolveProjectionUserKey,
    state,
  });

  return buildContainerRevokePlanResult({
    body,
    containerId: previousState.containerId,
    containerKey,
    containerKeyEpochId,
    event,
    eventHash,
    keyEpoch,
    manifest,
    manifestHash,
    parentKek,
    previousManifest: asContainerManifestBundle(target.manifest),
    previousProjection: input.previousProjection,
    principalPolicies,
    state,
    userRecipientKeys,
    wraps,
  });
}

export async function revokeRemoteContainer(input: {
  apiClient: ContainerRevokeApi;
  author: ContainerMutationAuthor;
  containerId: string;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  revokedSubject: ContainerRevokeSubject;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
}): Promise<{
  containerKey: Uint8Array;
  plan: ContainerRevokePlan;
  response: ContainerMutationResponse;
} | null> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote container revoke",
  );
  const previousProjection = await input.apiClient.getContainerWriterProjection(
    input.containerId,
  );
  if (!previousProjection) {
    return null;
  }

  const materializedPlan = await buildMaterializedContainerRevokePlan({
    author: input.author,
    eventId: input.eventId,
    execSql: input.execSql,
    previousProjection,
    revokedSubject: input.revokedSubject,
    resolveProjectionUserKey,
    signedAt: input.signedAt,
    targetSecretKey: input.targetSecretKey,
  });
  const response = await input.apiClient.revokeContainer(
    input.containerId,
    materializedPlan.plan.request,
  );
  if (!response) {
    return null;
  }

  return {
    containerKey: materializedPlan.containerKey,
    plan: materializedPlan.plan,
    response,
  };
}
