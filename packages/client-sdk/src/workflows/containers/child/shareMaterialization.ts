import type {
  ContainerAccessLevel,
  ContainerAccessManifestState,
  ContainerDirectGrant,
  ContainerGrantAccessEventBody,
  ContainerKekRecipientTarget,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
} from "@tearleads/crypto";
import type {
  ContainerKekResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { signContainerMutationEvent } from "../../../data/containers/shared/events";
import {
  asContainerManifestBundle,
  getTargetContainerContext,
  readContainerState,
  uniqueSortedManifestHashes,
  wrapContainerKeyToManagedPrincipal,
  wrapContainerKeyToRootUser,
} from "../../../data/containers/shared/projection";
import { readContainerKeyWraps } from "../../../data/containers/shared/readers";
import type {
  ContainerMutationAuthor,
  MaterializedContainerSharePlan,
} from "../../../data/containers/shared/types";
import { unwrapContainerKekPath } from "../../../data/documents/shared/projection";
import { projectionVerificationOptions } from "../../../data/documents/shared/types";
import type {
  PrincipalPolicyCache,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../../data/keyingProjectionVerification";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { requireUnwrappedKek } from "./rotationContext";
import {
  buildContainerSharePlanResult,
  type ContainerShareRecipient,
  collectContainerSharePrincipalPolicies,
  collectShareUserRecipientKeys,
  deriveContainerShareManifest,
  referencedPrincipalHeadFromPolicy,
  replaceContainerWrap,
  shareManifestHistory,
} from "./sharePlanCore";

async function materializeRecipientWrap(input: {
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  manifestHash: string;
  recipient: ContainerShareRecipient;
  state: ContainerAccessManifestState;
  targetKek: ContainerKekResponse;
}): Promise<{
  recipientTarget: ContainerKekRecipientTarget;
  userRecipientKeys: ContainerUserRecipientKey[];
  wrap: ContainerKeyWrap;
}> {
  if (input.recipient.subjectType === "user") {
    const shareRecipient = await wrapContainerKeyToRootUser({
      containerKey: input.containerKey,
      containerKeyEpochId: input.containerKeyEpochId,
      manifestHash: input.manifestHash,
      recipientEncapsulationPublicKey:
        input.recipient.recipientEncapsulationPublicKey,
      userId: input.recipient.subjectId,
    });
    return {
      recipientTarget: shareRecipient.recipientTarget,
      userRecipientKeys: collectShareUserRecipientKeys({
        newUserRecipientKey: shareRecipient.userRecipientKey,
        state: input.state,
        targetKek: input.targetKek,
      }),
      wrap: shareRecipient.wrap,
    };
  }

  const shareRecipient = await wrapContainerKeyToManagedPrincipal({
    containerKey: input.containerKey,
    containerKeyEpochId: input.containerKeyEpochId,
    manifestHash: input.manifestHash,
    principalEncapsulationPublicKey:
      input.recipient.principalPolicy.state.encapsulationPublicKey,
    principalHead: referencedPrincipalHeadFromPolicy(
      input.recipient.principalPolicy,
    ),
  });
  return {
    recipientTarget: shareRecipient.recipientTarget,
    userRecipientKeys: collectShareUserRecipientKeys({
      state: input.state,
      targetKek: input.targetKek,
    }),
    wrap: shareRecipient.wrap,
  };
}

interface BuildMaterializedContainerSharePlanInput {
  accessLevel: ContainerAccessLevel;
  author: ContainerMutationAuthor;
  eventId?: string | undefined;
  execSql: ExecSql;
  knownContainerKeks?: ReadonlyMap<string, Uint8Array> | undefined;
  principalPolicyCache?: PrincipalPolicyCache | undefined;
  previousProjection: ContainerWriterProjectionResponse;
  recipient: ContainerShareRecipient;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}

async function buildShareTransition(input: {
  accessLevel: ContainerAccessLevel;
  author: ContainerMutationAuthor;
  eventId?: string | undefined;
  previousProjection: ContainerWriterProjectionResponse;
  recipient: ContainerShareRecipient;
  signedAt?: string | undefined;
  targetManifest: ContainerWriterProjectionResponse["path"][number];
}) {
  const previousState = readContainerState(input.targetManifest);
  if (previousState.organizationId !== input.author.organizationId) {
    throw new Error("Container share author organization mismatch");
  }
  const grant: ContainerDirectGrant = {
    accessLevel: input.accessLevel,
    subjectId: input.recipient.subjectId,
    subjectType: input.recipient.subjectType,
  };
  const referencedPrincipalHead =
    input.recipient.subjectType === "user"
      ? null
      : referencedPrincipalHeadFromPolicy(input.recipient.principalPolicy);
  const body: ContainerGrantAccessEventBody = {
    eventType: "container.grant",
    containerKeyEpochId: previousState.containerKeyEpochId,
    grant,
    referencedPrincipalHead,
  };
  const { event, eventHash } = await signContainerMutationEvent({
    author: input.author,
    body,
    containerId: previousState.containerId,
    dependencyManifestHashes: uniqueSortedManifestHashes(
      input.previousProjection.path,
    ),
    eventId: input.eventId ?? crypto.randomUUID(),
    previousManifestHash: input.targetManifest.manifestHash,
    signedAt: input.signedAt ?? new Date().toISOString(),
  });
  const manifestTransition = await deriveContainerShareManifest({
    eventHash,
    grant,
    previousManifest: input.targetManifest,
    referencedPrincipalHead,
  });
  return {
    body,
    event,
    eventHash,
    grant,
    previousState,
    ...manifestTransition,
  };
}

export async function buildMaterializedContainerSharePlan(
  input: BuildMaterializedContainerSharePlanInput,
): Promise<MaterializedContainerSharePlan> {
  const keksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    knownContainerKeks: input.knownContainerKeks,
    principalPolicyCache: input.principalPolicyCache,
    projection: input.previousProjection,
    secretKey: input.targetSecretKey,
    ...projectionVerificationOptions(input),
  });
  const target = getTargetContainerContext(input.previousProjection);
  const {
    body,
    event,
    eventHash,
    grant,
    manifest,
    manifestHash,
    previousState,
    state,
  } = await buildShareTransition({
    accessLevel: input.accessLevel,
    author: input.author,
    eventId: input.eventId,
    previousProjection: input.previousProjection,
    recipient: input.recipient,
    signedAt: input.signedAt,
    targetManifest: target.manifest,
  });
  const containerKey = requireUnwrappedKek(
    keksByEpochId,
    target.kek,
    "Container share target",
  );
  const { recipientTarget, userRecipientKeys, wrap } =
    await materializeRecipientWrap({
      containerKey,
      containerKeyEpochId: target.kek.containerKeyEpochId,
      manifestHash,
      recipient: input.recipient,
      state,
      targetKek: target.kek,
    });
  const previousWraps = readContainerKeyWraps(
    target.kek.wraps,
    "Container share previous wraps",
  );
  const principalPolicies = await collectContainerSharePrincipalPolicies({
    execSql: input.execSql,
    principalPolicyCache: input.principalPolicyCache,
    previousProjection: input.previousProjection,
    ...(input.recipient.subjectType === "user"
      ? {}
      : { recipientPolicy: input.recipient.principalPolicy }),
    resolveUserKey: input.resolveProjectionUserKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });

  return buildContainerSharePlanResult({
    body,
    containerManifestHistory: shareManifestHistory({
      containerId: previousState.containerId,
      targetKek: target.kek,
      targetManifest: target.manifest,
    }),
    containerKey,
    containerId: previousState.containerId,
    event,
    eventHash,
    grant,
    manifest,
    manifestHash,
    previousManifest: asContainerManifestBundle(target.manifest),
    previousProjection: input.previousProjection,
    principalPolicies,
    recipientTarget,
    state,
    targetKek: target.kek,
    userRecipientKeys,
    wraps: replaceContainerWrap(previousWraps, wrap),
  });
}
