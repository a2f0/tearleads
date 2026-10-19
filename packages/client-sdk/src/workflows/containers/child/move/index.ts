import type {
  ContainerAccessManifestState,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type {
  ContainerRotationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { assertContainerAuthorAccess } from "../../../../data/containers/shared/authorAccess";
import { assertContainerChildPathFits } from "../../../../data/containers/shared/containerPathLimits";
import {
  asContainerManifestBundle,
  getTargetContainerContext,
  readContainerState,
  uniqueSortedManifestHashes,
} from "../../../../data/containers/shared/projection";
import type {
  BuildMaterializedContainerMovePlanInput,
  ContainerMoveApi,
  ContainerMovePlan,
  ContainerMutationAuthor,
  MaterializedContainerMovePlan,
} from "../../../../data/containers/shared/types";
import { unwrapContainerKekPath } from "../../../../data/documents/shared/projection";
import { projectionVerificationOptions } from "../../../../data/documents/shared/types";
import {
  nullOnProjectionVerificationCancellation,
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
  requireProjectionUserKeyResolver,
} from "../../../../data/keyingProjectionVerification";
import type { SecurityIncidentReporter } from "../../../../data/shared/securityIncidents";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";
import {
  submitAcknowledgedContainerMutation,
  submitContainerRotation,
} from "../mutationSubmit";
import { containerWriterProjectionFromRotationPlan } from "../rekey/rekeyProjection";
import {
  requireUnwrappedKek,
  type SignedRotationTarget,
  signedRotationTarget,
} from "../rotation/rotationContext";
import {
  buildMoveRotationWithBody,
  deriveMoveManifestArtifacts,
} from "./moveArtifacts";
import { buildContainerMovePlanResult } from "./moveRequest";
import {
  buildContainerMoveWraps,
  collectContainerMovePrincipalPolicies,
} from "./moveWraps";

async function unwrapMoveContainerKeys(input: {
  destinationParentProjection: ContainerWriterProjectionResponse;
  execSql: ExecSql;
  previousProjection: ContainerWriterProjectionResponse;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  stillCurrent?: (() => boolean) | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<{
  containerKey: Uint8Array;
  destinationParent: ReturnType<typeof getTargetContainerContext>;
  source: SignedRotationTarget;
}> {
  const verifiedByHash = new Map<string, VerifiedContainerAccessManifest>();
  const keksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    projection: input.previousProjection,
    secretKey: input.targetSecretKey,
    verifiedByHash,
    ...projectionVerificationOptions(input),
  });
  const source = signedRotationTarget(input.previousProjection, verifiedByHash);
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
  requireUnwrappedKek(
    destinationKeksByEpochId,
    destinationParent.kek,
    "Container move destination parent",
  );

  return { containerKey, destinationParent, source };
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

type MaterializedContainerMoveInput =
  BuildMaterializedContainerMovePlanInput & {
    resolveProjectionUserKey: ProjectionUserKeyResolver;
    stillCurrent?: (() => boolean) | undefined;
    warmReferencedPrincipalPolicies?:
      | ReferencedPrincipalPolicyWarmer
      | undefined;
  };

async function collectAuthorizedMovePolicies(
  input: MaterializedContainerMoveInput,
) {
  const principalPolicies = await collectContainerMovePrincipalPolicies({
    ...input,
    resolveUserKey: input.resolveProjectionUserKey,
  });
  assertContainerAuthorAccess({
    author: input.author,
    projection: input.previousProjection,
    principalPolicies,
    minimumAccess: "admin",
  });
  assertContainerAuthorAccess({
    author: input.author,
    projection: input.destinationParentProjection,
    principalPolicies,
    minimumAccess: "write",
  });
  return principalPolicies;
}

/**
 * The source's verified head already sits under the destination: a move the
 * server accepted but this device never settled, or one another writer made.
 */
export interface AppliedContainerMove {
  readonly manifestHash: string;
  readonly state: ContainerAccessManifestState;
}

/** Verifies both projections and reads the states a move rotates between. */
async function verifyContainerMoveSources(
  input: MaterializedContainerMoveInput,
) {
  const unwrapped = await unwrapMoveContainerKeys({
    destinationParentProjection: input.destinationParentProjection,
    execSql: input.execSql,
    previousProjection: input.previousProjection,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    stillCurrent: input.stillCurrent,
    targetSecretKey: input.targetSecretKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  // Only a verified path is a final depth refusal; a padded unverified path
  // must fail verification (an incident), never look like an honest refusal.
  assertContainerChildPathFits(input.destinationParentProjection.path);
  return {
    ...unwrapped,
    ...readContainerMoveStates({
      authorOrganizationId: input.author.organizationId,
      destinationParent: unwrapped.destinationParent,
      source: unwrapped.source,
    }),
  };
}

async function buildMaterializedContainerMovePlan(
  input: MaterializedContainerMoveInput & { adoptAppliedMove: boolean },
): Promise<MaterializedContainerMovePlan | { applied: AppliedContainerMove }> {
  const {
    containerKey: predecessorContainerKey,
    destinationParent,
    destinationState,
    previousState,
    source,
  } = await verifyContainerMoveSources(input);
  if (
    input.adoptAppliedMove &&
    previousState.parentContainerId === destinationState.containerId
  )
    return {
      applied: {
        manifestHash: source.manifest.manifestHash,
        state: previousState,
      },
    };
  const principalPolicies = await collectAuthorizedMovePolicies(input);
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
  const { userRecipientKeys, wraps } = await buildContainerMoveWraps({
    principalPolicies,
    containerKey,
    containerKeyEpochId,
    destinationParentKek: destinationParent.kek,
    destinationParentProjection: input.destinationParentProjection,
    execSql: input.execSql,
    manifestHash,
    previousProjection: input.previousProjection,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    state,
    stillCurrent: input.stillCurrent,
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

interface MoveRemoteContainerInput {
  reportSecurityIncident: SecurityIncidentReporter;
  apiClient: ContainerMoveApi;
  author: ContainerMutationAuthor;
  containerId: string;
  destinationParentContainerId: string;
  eventId?: string | undefined;
  execSql: ExecSql;
  onAccepted?: (() => void) | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  stillCurrent?: (() => boolean) | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}

interface SubmittedContainerMove {
  containerKey: Uint8Array;
  plan: ContainerMovePlan;
  response: ContainerRotationResponse;
}

/** Signs and submits a move; `null` when it was refused or abandoned. */
export async function moveRemoteContainer(
  input: MoveRemoteContainerInput,
): Promise<SubmittedContainerMove | null> {
  const moved = await submitRemoteContainerMove(input, false);
  if (moved && "applied" in moved)
    throw new Error("A move that adopts nothing cannot report one applied");
  return moved;
}

/**
 * Replays a queued move. When the verified source head already sits under
 * the destination it signs nothing and returns that head, so a lost response
 * settles without a second rotation.
 */
export function replayRemoteContainerMove(
  input: MoveRemoteContainerInput,
): Promise<SubmittedContainerMove | { applied: AppliedContainerMove } | null> {
  return submitRemoteContainerMove(input, true);
}

async function submitRemoteContainerMove(
  input: MoveRemoteContainerInput,
  adoptAppliedMove: boolean,
): Promise<SubmittedContainerMove | { applied: AppliedContainerMove } | null> {
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

  const materializedPlan = await nullOnProjectionVerificationCancellation(() =>
    buildMaterializedContainerMovePlan({
      adoptAppliedMove,
      author: input.author,
      eventId: input.eventId,
      execSql: input.execSql,
      previousProjection,
      destinationParentProjection,
      resolveProjectionUserKey,
      signedAt: input.signedAt,
      stillCurrent: input.stillCurrent,
      targetSecretKey: input.targetSecretKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    }),
  );
  if (!materializedPlan || "applied" in materializedPlan)
    return materializedPlan;
  return submitAcknowledgedContainerMutation({
    reportSecurityIncident: input.reportSecurityIncident,
    recitationPolicies: [],
    apiClient: input.apiClient,
    author: input.author,
    carriedRekeys: {
      planning: {
        apiClient: input.apiClient,
        author: input.author,
        execSql: input.execSql,
        knownContainerKeks: new Map([
          [
            materializedPlan.plan.containerKeyEpochId,
            materializedPlan.containerKey,
          ],
        ]),
        resolveProjectionUserKey: resolveProjectionUserKey,
        stillCurrent: input.stillCurrent,
        targetSecretKey: input.targetSecretKey,
        warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      },
      rotated: () =>
        containerWriterProjectionFromRotationPlan({
          ancestors: destinationParentProjection,
          plan: materializedPlan.plan,
          previousProjection,
        }),
    },
    containerKey: materializedPlan.containerKey,
    execSql: input.execSql,
    onAccepted: input.onAccepted,
    plan: materializedPlan.plan,
    stillCurrent: input.stillCurrent,
    submit: (carried) =>
      submitContainerMoveRequest(input, {
        ...materializedPlan.plan.request,
        ...(carried.length ? { containerRekeys: [...carried] } : {}),
      }),
  });
}

function submitContainerMoveRequest(
  input: MoveRemoteContainerInput,
  request: ContainerMutationRequest,
) {
  const options = {
    expectedPaymentRequiredOrganizationId: input.author.organizationId,
  };
  const { moveContainerResult } = input.apiClient;
  return submitContainerRotation({
    plain: () =>
      input.apiClient.moveContainer(input.containerId, request, options),
    result: moveContainerResult
      ? () =>
          moveContainerResult.call(
            input.apiClient,
            input.containerId,
            request,
            {
              ...options,
              reportErrors: false,
            },
          )
      : undefined,
  });
}
