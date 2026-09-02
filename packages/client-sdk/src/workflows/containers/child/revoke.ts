import type {
  AccessEvent,
  AccessManifest,
  ContainerAccessManifestState,
  ContainerKekKeyring,
  ContainerKekPredecessorBridge,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerRevokeAccessEventBody,
  ContainerUserRecipientKey,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computeContainerKekKeyringHash,
  computeContainerKekPredecessorBridgeHash,
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
  signContainerMutationEvent,
} from "../../../data/containers/shared/events";
import { uniquePrincipalPolicies } from "../../../data/containers/shared/principalPolicies";
import {
  asContainerManifestBundle,
  uniqueSortedManifestHashes,
} from "../../../data/containers/shared/projection";
import type {
  ContainerMutationAuthor,
  ContainerRevokeApi,
  ContainerRevokePlan,
  MaterializedContainerRevokePlan,
} from "../../../data/containers/shared/types";
import { readCanonicalRecord } from "../../../data/keyingCanonicalJson";
import {
  collectContainerWriterProjectionPrincipalPolicies,
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
  requireProjectionUserKeyResolver,
} from "../../../data/keyingProjectionVerification";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { buildContainerRotationArtifacts } from "./moveRotation";
import {
  containerMutationRequestCore,
  previousPathRequestFields,
  readCanonicalRecordOrNull,
} from "./mutationRequestCore";
import { submitAcknowledgedContainerMutation } from "./mutationSubmit";
import {
  type ContainerRevokeSubject,
  deriveContainerRevokeManifest,
} from "./revokeManifest";
import { resolveRotationContext } from "./rotationContext";
import { buildContainerRotationWraps } from "./rotationWraps";

function buildContainerRevokeRequest(input: {
  body: ContainerRevokeAccessEventBody;
  event: AccessEvent;
  keyEpoch: ContainerKeyEpoch;
  keyring: ContainerKekKeyring;
  manifest: AccessManifest;
  manifestHash: string;
  parentKek: ContainerKekResponse | null;
  predecessorBridge: ContainerKekPredecessorBridge;
  previousManifest: AccessManifestBundleWire;
  previousProjection: ContainerWriterProjectionResponse;
  principalPolicies: readonly VerifiedPrincipalPolicy[];
  userRecipientKeys: readonly ContainerUserRecipientKey[];
  wraps: readonly ContainerKeyWrap[];
}): ContainerMutationRequest {
  return {
    ...containerMutationRequestCore("revoke", input),
    ...previousPathRequestFields(
      input.previousManifest,
      input.previousProjection,
    ),
    predecessorBridge: readCanonicalRecord(
      input.predecessorBridge,
      "Container revoke predecessor bridge",
    ),
    keyring: readCanonicalRecord(input.keyring, "Container revoke keyring"),
    parentKekState: readCanonicalRecordOrNull(
      input.parentKek,
      "Container revoke parent KEK state",
    ),
  };
}

export async function collectContainerRevokePrincipalPolicies(input: {
  execSql: ExecSql;
  persistVerificationCheckpoints?: boolean | undefined;
  previousProjection: ContainerWriterProjectionResponse;
  resolveUserKey: ProjectionUserKeyResolver;
  stillCurrent?: (() => boolean) | undefined;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<VerifiedPrincipalPolicy[]> {
  return uniquePrincipalPolicies(
    await collectContainerWriterProjectionPrincipalPolicies({
      execSql: input.execSql,
      persistVerificationCheckpoints: input.persistVerificationCheckpoints,
      projection: input.previousProjection,
      resolveUserKey: input.resolveUserKey,
      stillCurrent: input.stillCurrent,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
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
  keyring: ContainerKekKeyring;
  manifest: AccessManifest;
  manifestHash: string;
  parentKek: ContainerKekResponse | null;
  predecessorBridge: ContainerKekPredecessorBridge;
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
      keyring: input.keyring,
      manifest: input.manifest,
      manifestHash: input.manifestHash,
      parentKek: input.parentKek,
      predecessorBridge: input.predecessorBridge,
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
export async function buildMaterializedContainerRevokePlan(input: {
  author: ContainerMutationAuthor;
  eventId?: string | undefined;
  execSql: ExecSql;
  previousProjection: ContainerWriterProjectionResponse;
  replacementPrincipalPolicy?: VerifiedPrincipalPolicy | undefined;
  revokedSubject: ContainerRevokeSubject;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  stillCurrent?: (() => boolean) | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<MaterializedContainerRevokePlan> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote container revoke",
  );
  const {
    parentKek,
    parentKekMaterial,
    predecessorContainerKey,
    previousState,
    target,
  } = await resolveRotationContext(input, "revoke");
  const nextContainerKeyEpoch = target.kek.containerKeyEpoch + 1;
  const { containerKey, containerKeyEpochId, keyring, predecessorBridge } =
    await buildContainerRotationArtifacts({
      containerId: previousState.containerId,
      currentKek: target.kek,
      currentKeyMaterial: predecessorContainerKey,
      keyEpoch: nextContainerKeyEpoch,
    });
  const body: ContainerRevokeAccessEventBody = {
    eventType: "container.revoke",
    containerKeyEpochId,
    keyringHash: await computeContainerKekKeyringHash(keyring),
    predecessorBridgeHash:
      await computeContainerKekPredecessorBridgeHash(predecessorBridge),
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
    keyEpoch: nextContainerKeyEpoch,
    manifestHash,
    parentContainerKeyEpochId: parentKek?.containerKeyEpochId ?? null,
  });
  const principalPolicies = await collectContainerRevokePrincipalPolicies({
    execSql: input.execSql,
    previousProjection: input.previousProjection,
    resolveUserKey: resolveProjectionUserKey,
    stillCurrent: input.stillCurrent,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  const replacementPrincipalPolicy = input.replacementPrincipalPolicy;
  if (
    replacementPrincipalPolicy &&
    (replacementPrincipalPolicy.principalType !==
      input.revokedSubject.subjectType ||
      replacementPrincipalPolicy.principalId !== input.revokedSubject.subjectId)
  ) {
    throw new Error("Container revoke replacement principal does not match");
  }
  const currentPrincipalPolicies = replacementPrincipalPolicy
    ? principalPolicies.filter(
        (policy) =>
          policy.principalType !== replacementPrincipalPolicy.principalType ||
          policy.principalId !== replacementPrincipalPolicy.principalId,
      )
    : principalPolicies;
  const { userRecipientKeys, wraps } = await buildContainerRotationWraps({
    containerKey,
    containerKeyEpochId,
    manifestHash,
    operationLabel: "Container revoke",
    parentKek,
    parentKekMaterial,
    principalPolicies: currentPrincipalPolicies,
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
    keyring,
    manifest,
    manifestHash,
    parentKek,
    predecessorBridge,
    previousManifest: asContainerManifestBundle(target.manifest),
    previousProjection: input.previousProjection,
    principalPolicies: currentPrincipalPolicies,
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
  execSql: ExecSql;
  revokedSubject: ContainerRevokeSubject;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  stillCurrent?: (() => boolean) | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<{
  containerKey: Uint8Array;
  plan: ContainerRevokePlan;
  response: ContainerMutationResponse;
} | null> {
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
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    signedAt: input.signedAt,
    stillCurrent: input.stillCurrent,
    targetSecretKey: input.targetSecretKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  return submitAcknowledgedContainerMutation({
    containerKey: materializedPlan.containerKey,
    execSql: input.execSql,
    plan: materializedPlan.plan,
    stillCurrent: input.stillCurrent,
    submit: () =>
      input.apiClient.revokeContainer(
        input.containerId,
        materializedPlan.plan.request,
      ),
  });
}
