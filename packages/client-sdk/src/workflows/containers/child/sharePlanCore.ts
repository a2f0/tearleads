import {
  type AccessEvent,
  type AccessManifest,
  type ContainerAccessManifestState,
  type ContainerDirectGrant,
  type ContainerGrantAccessEventBody,
  type ContainerGrantPrincipalHead,
  type ContainerKekRecipientTarget,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  type ContainerUserRecipientKey,
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  type VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@symcrypt/validators/request";
import type {
  ContainerKekResponse,
  ContainerWriterProjectionResponse,
} from "@symcrypt/validators/response";
import { uniquePrincipalPolicies } from "../../../data/containers/shared/principalPolicies";
import {
  asContainerManifestBundle,
  getParentKekForTarget,
  readContainerState,
} from "../../../data/containers/shared/projection";
import {
  readContainerKekRecipientTargets,
  readContainerKeyEpoch,
} from "../../../data/containers/shared/readers";
import type {
  ContainerSharePlan,
  MaterializedContainerSharePlan,
} from "../../../data/containers/shared/types";
import {
  collectContainerWriterProjectionPrincipalPolicies,
  type PrincipalPolicyCache,
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
} from "../../../data/keyingProjectionVerification";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  containerMutationRequestCore,
  previousPathRequestFields,
  readCanonicalRecordOrNull,
} from "./mutationRequestCore";

export type ContainerShareRecipient =
  | {
      readonly recipientEncapsulationPublicKey: Uint8Array;
      readonly subjectId: string;
      readonly subjectType: "user";
    }
  | {
      readonly principalPolicy: VerifiedPrincipalPolicy;
      readonly subjectId: string;
      readonly subjectType: "group";
    };

function grantKey(
  grant: Pick<ContainerDirectGrant, "subjectId" | "subjectType">,
): string {
  return `${grant.subjectType}:${grant.subjectId}`;
}

function upsertContainerGrant(
  grants: readonly ContainerDirectGrant[],
  grant: ContainerDirectGrant,
): ContainerDirectGrant[] {
  return [
    ...grants.filter(
      (existingGrant) => grantKey(existingGrant) !== grantKey(grant),
    ),
    grant,
  ].sort((left, right) => grantKey(left).localeCompare(grantKey(right)));
}

function referencedPrincipalKey(reference: {
  readonly principalId: string;
  readonly principalType: "group";
}): string {
  return `${reference.principalType}:${reference.principalId}`;
}

export function referencedPrincipalHeadFromPolicy(
  policy: VerifiedPrincipalPolicy,
): ContainerGrantPrincipalHead {
  if (policy.principalType !== "group") {
    throw new Error("Container grants can reference only group policies");
  }
  return {
    principalType: "group",
    principalId: policy.principalId,
    version: policy.version,
    keyEpoch: policy.keyEpoch,
    stateHash: policy.stateHash,
    keyFingerprint: policy.state.keyFingerprint,
  };
}

function upsertReferencedPrincipalHead(
  references: readonly ContainerGrantPrincipalHead[],
  reference: ContainerGrantPrincipalHead,
): ContainerGrantPrincipalHead[] {
  return [
    ...references.filter(
      (existingReference) =>
        referencedPrincipalKey(existingReference) !==
        referencedPrincipalKey(reference),
    ),
    reference,
  ].sort((left, right) =>
    referencedPrincipalKey(left).localeCompare(referencedPrincipalKey(right)),
  );
}

/**
 * The previous manifest's referenced principal heads with the replacement
 * policy's head upserted in place of any stale head for the same principal.
 */
export function refreshedPrincipalReferences(input: {
  readonly previousState: ContainerAccessManifestState;
  readonly replacementPrincipalPolicy?: VerifiedPrincipalPolicy | undefined;
}): ContainerGrantPrincipalHead[] {
  const replacement = input.replacementPrincipalPolicy;
  if (!replacement) {
    return [...input.previousState.referencedPrincipalHeads];
  }
  return upsertReferencedPrincipalHead(
    input.previousState.referencedPrincipalHeads,
    referencedPrincipalHeadFromPolicy(replacement),
  );
}

/**
 * The previous policies with the replacement policy substituted for any
 * existing policy of the same principal identity.
 */
export function refreshedPrincipalPolicies(input: {
  readonly previousPolicies: readonly VerifiedPrincipalPolicy[];
  readonly replacementPrincipalPolicy?: VerifiedPrincipalPolicy | undefined;
}): VerifiedPrincipalPolicy[] {
  const replacement = input.replacementPrincipalPolicy;
  if (!replacement) {
    return uniquePrincipalPolicies(input.previousPolicies);
  }
  return uniquePrincipalPolicies([
    ...input.previousPolicies.filter(
      (policy) =>
        policy.principalType !== replacement.principalType ||
        policy.principalId !== replacement.principalId,
    ),
    replacement,
  ]);
}

export async function deriveContainerShareManifest(input: {
  eventHash: string;
  grant: ContainerDirectGrant;
  previousManifest: ContainerWriterProjectionResponse["path"][number];
  referencedPrincipalHead: ContainerGrantPrincipalHead | null;
}): Promise<Pick<ContainerSharePlan, "manifest" | "manifestHash" | "state">> {
  const previousState = readContainerState(input.previousManifest);
  const state: ContainerAccessManifestState = {
    ...previousState,
    epoch: previousState.epoch + 1,
    previousManifestHash: input.previousManifest.manifestHash,
    eventHash: input.eventHash,
    directGrants: upsertContainerGrant(previousState.directGrants, input.grant),
    referencedPrincipalHeads: input.referencedPrincipalHead
      ? upsertReferencedPrincipalHead(
          previousState.referencedPrincipalHeads,
          input.referencedPrincipalHead,
        )
      : previousState.referencedPrincipalHeads,
  };
  const manifest = await deriveContainerAccessManifest(state);

  return {
    manifest,
    manifestHash: await computeAccessManifestHash(manifest),
    state,
  };
}

function buildContainerShareRequest(input: {
  body: ContainerGrantAccessEventBody;
  containerManifestHistory: readonly AccessManifestBundleWire[];
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
    ...containerMutationRequestCore("share", input),
    ...previousPathRequestFields(
      input.previousManifest,
      input.previousProjection,
    ),
    containerManifestHistory: [...input.containerManifestHistory],
    predecessorBridge: null,
    keyring: null,
    parentKekState: readCanonicalRecordOrNull(
      input.parentKek,
      "Container share parent KEK state",
    ),
  };
}

export function replaceContainerWrap(
  wraps: readonly ContainerKeyWrap[],
  nextWrap: ContainerKeyWrap,
): ContainerKeyWrap[] {
  return [
    ...wraps.filter(
      (wrap) =>
        !(
          wrap.recipientKind === nextWrap.recipientKind &&
          wrap.recipientId === nextWrap.recipientId
        ),
    ),
    nextWrap,
  ];
}

export function shareManifestHistory(input: {
  readonly containerId: string;
  readonly targetKek: ContainerKekResponse;
  readonly targetManifest: ContainerWriterProjectionResponse["path"][number];
}): AccessManifestBundleWire[] {
  const byHash = new Map<string, AccessManifestBundleWire>();
  for (const bundle of [
    input.targetManifest,
    ...input.targetKek.containerManifestHistory,
  ]) {
    if (
      readContainerState(bundle).containerId === input.containerId &&
      !byHash.has(bundle.manifestHash)
    ) {
      byHash.set(bundle.manifestHash, asContainerManifestBundle(bundle));
    }
  }
  return [...byHash.values()];
}

export function buildContainerSharePlanResult(input: {
  body: ContainerGrantAccessEventBody;
  containerManifestHistory: readonly AccessManifestBundleWire[];
  containerId: string;
  containerKey: Uint8Array;
  event: AccessEvent;
  eventHash: string;
  grant: ContainerDirectGrant;
  manifest: AccessManifest;
  manifestHash: string;
  previousManifest: AccessManifestBundleWire;
  previousProjection: ContainerWriterProjectionResponse;
  principalPolicies: readonly VerifiedPrincipalPolicy[];
  recipientTarget: ContainerKekRecipientTarget;
  state: ContainerAccessManifestState;
  targetKek: ContainerKekResponse;
  userRecipientKeys: ContainerUserRecipientKey[];
  wraps: ContainerKeyWrap[];
}): MaterializedContainerSharePlan {
  const keyEpoch = readContainerKeyEpoch(
    input.targetKek.keyEpoch,
    "Container share key epoch",
  );
  const plan: ContainerSharePlan = {
    body: input.body,
    containerId: input.containerId,
    event: input.event,
    eventHash: input.eventHash,
    grant: input.grant,
    keyEpoch,
    manifest: input.manifest,
    manifestHash: input.manifestHash,
    previousKeyring: readCanonicalRecordOrNull(
      input.previousProjection.containerKeks.at(-1)?.keyring ?? null,
      "Container share previous keyring",
    ),
    previousManifest: input.previousManifest,
    recipientTarget: input.recipientTarget,
    request: buildContainerShareRequest({
      body: input.body,
      containerManifestHistory: input.containerManifestHistory,
      event: input.event,
      keyEpoch,
      manifest: input.manifest,
      manifestHash: input.manifestHash,
      parentKek: getParentKekForTarget(input.previousProjection),
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

export function collectShareUserRecipientKeys(input: {
  newUserRecipientKey?: ContainerUserRecipientKey | undefined;
  state: ContainerAccessManifestState;
  targetKek: ContainerKekResponse;
}): ContainerUserRecipientKey[] {
  const directUserIds = new Set(
    input.state.directGrants.flatMap((grant) =>
      grant.subjectType === "user" ? [grant.subjectId] : [],
    ),
  );
  const userRecipientKeyByUserId = new Map<string, ContainerUserRecipientKey>();

  for (const target of readContainerKekRecipientTargets(
    input.targetKek.recipientTargets,
    "Container share target KEK recipient targets",
  )) {
    if (
      target.recipientKind !== "user" ||
      !directUserIds.has(target.recipientId)
    ) {
      continue;
    }
    userRecipientKeyByUserId.set(target.recipientId, {
      userId: target.recipientId,
      recipientKeyEpochId: target.recipientKeyEpochId,
      recipientKeyFingerprint: target.recipientKeyFingerprint,
    });
  }

  if (input.newUserRecipientKey) {
    userRecipientKeyByUserId.set(
      input.newUserRecipientKey.userId,
      input.newUserRecipientKey,
    );
  }

  const missingUserId = [...directUserIds].find(
    (userId) => !userRecipientKeyByUserId.has(userId),
  );
  if (missingUserId) {
    throw new Error(
      `Container share recipient key is missing for direct user grant ${missingUserId}`,
    );
  }

  return [...userRecipientKeyByUserId.values()].sort((left, right) =>
    left.userId.localeCompare(right.userId),
  );
}

export async function collectContainerSharePrincipalPolicies(input: {
  execSql: ExecSql;
  principalPolicyCache?: PrincipalPolicyCache | undefined;
  previousProjection: ContainerWriterProjectionResponse;
  recipientPolicy?: VerifiedPrincipalPolicy | undefined;
  resolveUserKey: ProjectionUserKeyResolver;
  stillCurrent?: (() => boolean) | undefined;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<VerifiedPrincipalPolicy[]> {
  const previousPolicies =
    await collectContainerWriterProjectionPrincipalPolicies({
      execSql: input.execSql,
      principalPolicyCache: input.principalPolicyCache,
      projection: input.previousProjection,
      resolveUserKey: input.resolveUserKey,
      stillCurrent: input.stillCurrent,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
  return refreshedPrincipalPolicies({
    previousPolicies,
    replacementPrincipalPolicy: input.recipientPolicy,
  });
}
