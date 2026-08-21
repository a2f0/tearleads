import type {
  AccessEvent,
  AccessManifest,
  ContainerAccessManifestState,
  ContainerKekKeyring,
  ContainerKekPredecessorBridge,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerMoveAccessEventBody,
  ContainerUserRecipientKey,
  VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@symcrypt/validators/request";
import type {
  ContainerKekResponse,
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@symcrypt/validators/response";
import {
  asContainerManifestBundle,
  getTargetContainerContext,
  readContainerState,
  uniqueSortedManifestHashes,
} from "../../../data/containers/shared/projection";
import type {
  BuildMaterializedContainerMovePlanInput,
  ContainerMoveApi,
  ContainerMovePlan,
  ContainerMutationAuthor,
  MaterializedContainerMovePlan,
} from "../../../data/containers/shared/types";
import { unwrapContainerKekPath } from "../../../data/documents/shared/projection";
import { projectionVerificationOptions } from "../../../data/documents/shared/types";
import { readCanonicalRecord } from "../../../data/keyingCanonicalJson";
import {
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
  requireProjectionUserKeyResolver,
} from "../../../data/keyingProjectionVerification";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  buildMoveRotationWithBody,
  deriveMoveManifestArtifacts,
} from "./moveArtifacts";
import { buildContainerMoveWraps } from "./moveWraps";
import {
  containerMutationRequestCore,
  previousPathRequestFields,
} from "./mutationRequestCore";
import { submitAcknowledgedContainerMutation } from "./mutationSubmit";
import { requireUnwrappedKek } from "./rotationContext";

function buildContainerMoveRequest(input: {
  body: ContainerMoveAccessEventBody;
  destinationParentKek: ContainerKekResponse;
  destinationParentProjection: ContainerWriterProjectionResponse;
  event: AccessEvent;
  keyEpoch: ContainerKeyEpoch;
  keyring: ContainerKekKeyring;
  manifest: AccessManifest;
  manifestHash: string;
  previousManifest: AccessManifestBundleWire;
  previousProjection: ContainerWriterProjectionResponse;
  predecessorBridge: ContainerKekPredecessorBridge;
  principalPolicies: readonly VerifiedPrincipalPolicy[];
  userRecipientKeys: readonly ContainerUserRecipientKey[];
  wraps: readonly ContainerKeyWrap[];
}): ContainerMutationRequest {
  return {
    ...containerMutationRequestCore("move", input),
    ...previousPathRequestFields(
      input.previousManifest,
      input.previousProjection,
    ),
    destinationParentContainerPath: input.destinationParentProjection.path.map(
      asContainerManifestBundle,
    ),
    predecessorBridge: readCanonicalRecord(
      input.predecessorBridge,
      "Container move predecessor bridge",
    ),
    keyring: readCanonicalRecord(input.keyring, "Container move keyring"),
    parentKekState: readCanonicalRecord(
      input.destinationParentKek,
      "Container move destination parent KEK state",
    ),
  };
}

async function unwrapMoveContainerKeys(input: {
  destinationParentProjection: ContainerWriterProjectionResponse;
  execSql: ExecSql;
  previousProjection: ContainerWriterProjectionResponse;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<{
  containerKey: Uint8Array;
  destinationParentKey: Uint8Array;
  destinationParent: ReturnType<typeof getTargetContainerContext>;
  source: ReturnType<typeof getTargetContainerContext>;
}> {
  const keksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    projection: input.previousProjection,
    secretKey: input.targetSecretKey,
    ...projectionVerificationOptions(input),
  });
  const source = getTargetContainerContext(input.previousProjection);
  const containerKey = requireUnwrappedKek(
    keksByEpochId,
    source.kek,
    "Container move source",
  );

  const destinationKeksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    projection: input.destinationParentProjection,
    secretKey: input.targetSecretKey,
    ...projectionVerificationOptions(input),
  });
  const destinationParent = getTargetContainerContext(
    input.destinationParentProjection,
  );
  const destinationParentKey = requireUnwrappedKek(
    destinationKeksByEpochId,
    destinationParent.kek,
    "Container move destination parent",
  );

  return { containerKey, destinationParentKey, destinationParent, source };
}

function assertContainerMoveOrganizations(input: {
  authorOrganizationId: string;
  destinationState: ContainerAccessManifestState;
  previousState: ContainerAccessManifestState;
}): void {
  if (input.previousState.organizationId !== input.authorOrganizationId) {
    throw new Error("Container move author organization mismatch");
  }
  if (input.destinationState.organizationId !== input.authorOrganizationId) {
    throw new Error("Container move destination organization mismatch");
  }
}

function readContainerMoveStates(input: {
  authorOrganizationId: string;
  destinationParent: ReturnType<typeof getTargetContainerContext>;
  source: ReturnType<typeof getTargetContainerContext>;
}) {
  const previousState = readContainerState(input.source.manifest);
  const destinationState = readContainerState(input.destinationParent.manifest);
  assertContainerMoveOrganizations({
    authorOrganizationId: input.authorOrganizationId,
    destinationState,
    previousState,
  });
  return { destinationState, previousState };
}

function containerMoveDependencyManifestHashes(input: {
  destinationParentProjection: ContainerWriterProjectionResponse;
  previousProjection: ContainerWriterProjectionResponse;
}): string[] {
  return [
    ...uniqueSortedManifestHashes(input.previousProjection.path),
    ...uniqueSortedManifestHashes(input.destinationParentProjection.path),
  ];
}

function buildContainerMovePlanResult(input: {
  body: ContainerMoveAccessEventBody;
  containerId: string;
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  destinationParentKek: ContainerKekResponse;
  destinationParentProjection: ContainerWriterProjectionResponse;
  event: AccessEvent;
  eventHash: string;
  keyEpoch: ContainerKeyEpoch;
  keyring: ContainerKekKeyring;
  manifest: AccessManifest;
  manifestHash: string;
  previousManifest: AccessManifestBundleWire;
  previousProjection: ContainerWriterProjectionResponse;
  predecessorBridge: ContainerKekPredecessorBridge;
  principalPolicies: readonly VerifiedPrincipalPolicy[];
  state: ContainerAccessManifestState;
  userRecipientKeys: ContainerUserRecipientKey[];
  wraps: ContainerKeyWrap[];
}): MaterializedContainerMovePlan {
  const plan: ContainerMovePlan = {
    body: input.body,
    containerId: input.containerId,
    containerKeyEpochId: input.containerKeyEpochId,
    event: input.event,
    eventHash: input.eventHash,
    keyEpoch: input.keyEpoch,
    manifest: input.manifest,
    manifestHash: input.manifestHash,
    previousManifest: input.previousManifest,
    request: buildContainerMoveRequest({
      body: input.body,
      destinationParentKek: input.destinationParentKek,
      destinationParentProjection: input.destinationParentProjection,
      event: input.event,
      keyEpoch: input.keyEpoch,
      keyring: input.keyring,
      manifest: input.manifest,
      manifestHash: input.manifestHash,
      previousManifest: input.previousManifest,
      previousProjection: input.previousProjection,
      predecessorBridge: input.predecessorBridge,
      principalPolicies: input.principalPolicies,
      userRecipientKeys: input.userRecipientKeys,
      wraps: input.wraps,
    }),
    state: input.state,
    wraps: input.wraps,
  };

  return { containerKey: input.containerKey, plan };
}

type MaterializedContainerMoveInput =
  BuildMaterializedContainerMovePlanInput & {
    resolveProjectionUserKey: ProjectionUserKeyResolver;
    warmReferencedPrincipalPolicies?:
      | ReferencedPrincipalPolicyWarmer
      | undefined;
  };

async function buildMaterializedContainerMovePlan(
  input: MaterializedContainerMoveInput,
): Promise<MaterializedContainerMovePlan> {
  const {
    containerKey: predecessorContainerKey,
    destinationParent,
    destinationParentKey,
    source,
  } = await unwrapMoveContainerKeys({
    destinationParentProjection: input.destinationParentProjection,
    execSql: input.execSql,
    previousProjection: input.previousProjection,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    targetSecretKey: input.targetSecretKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  const { destinationState, previousState } = readContainerMoveStates({
    authorOrganizationId: input.author.organizationId,
    destinationParent,
    source,
  });
  const {
    body,
    containerKey,
    containerKeyEpochId,
    keyring,
    predecessorBridge,
  } = await buildMoveRotationWithBody({
    destinationParent,
    destinationState,
    override: input.containerKeyEpochId,
    predecessorContainerKey,
    previousState,
    source,
  });
  const { event, eventHash, keyEpoch, manifest, manifestHash, state } =
    await deriveMoveManifestArtifacts({
      body,
      containerKeyEpochId,
      destinationParent,
      previousState,
      signing: {
        author: input.author,
        dependencyManifestHashes: containerMoveDependencyManifestHashes(input),
        eventId: input.eventId,
        signedAt: input.signedAt,
      },
      source,
    });
  const { principalPolicies, userRecipientKeys, wraps } =
    await buildContainerMoveWraps({
      containerKey,
      containerKeyEpochId,
      destinationParentKek: destinationParent.kek,
      destinationParentKey,
      destinationParentProjection: input.destinationParentProjection,
      execSql: input.execSql,
      manifestHash,
      previousProjection: input.previousProjection,
      resolveProjectionUserKey: input.resolveProjectionUserKey,
      state,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });

  return buildContainerMovePlanResult({
    body,
    containerKey,
    containerId: previousState.containerId,
    containerKeyEpochId,
    destinationParentKek: destinationParent.kek,
    destinationParentProjection: input.destinationParentProjection,
    event,
    eventHash,
    keyEpoch,
    keyring,
    manifest,
    manifestHash,
    previousManifest: asContainerManifestBundle(source.manifest),
    previousProjection: input.previousProjection,
    predecessorBridge,
    principalPolicies,
    state,
    userRecipientKeys,
    wraps,
  });
}

export async function moveRemoteContainer(input: {
  apiClient: ContainerMoveApi;
  author: ContainerMutationAuthor;
  containerId: string;
  destinationParentContainerId: string;
  eventId?: string | undefined;
  execSql: ExecSql;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<{
  containerKey: Uint8Array;
  plan: ContainerMovePlan;
  response: ContainerMutationResponse;
} | null> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote container move",
  );
  const [previousProjection, destinationParentProjection] = await Promise.all([
    input.apiClient.getContainerWriterProjection(input.containerId),
    input.apiClient.getContainerWriterProjection(
      input.destinationParentContainerId,
    ),
  ]);
  if (!previousProjection || !destinationParentProjection) {
    return null;
  }

  const materializedPlan = await buildMaterializedContainerMovePlan({
    author: input.author,
    eventId: input.eventId,
    execSql: input.execSql,
    previousProjection,
    destinationParentProjection,
    resolveProjectionUserKey,
    signedAt: input.signedAt,
    targetSecretKey: input.targetSecretKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  return submitAcknowledgedContainerMutation({
    containerKey: materializedPlan.containerKey,
    execSql: input.execSql,
    plan: materializedPlan.plan,
    submit: () =>
      input.apiClient.moveContainer(
        input.containerId,
        materializedPlan.plan.request,
      ),
  });
}
