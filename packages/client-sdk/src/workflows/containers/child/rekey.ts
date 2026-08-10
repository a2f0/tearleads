import type {
  ContainerKekKeyring,
  ContainerKekKeyringEntry,
  ContainerRekeyAccessEventBody,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  computeContainerKekKeyringHash,
  computeContainerKekPredecessorBridgeHash,
  createContainerKekPredecessorBridge,
  deriveContainerAccessManifest,
  sealContainerKekKeyring,
} from "@tearleads/crypto";
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
  asContainerManifestBundle,
  type getParentKekForTarget,
  type getTargetContainerContext,
  type readContainerState,
  uniqueSortedManifestHashes,
} from "../../../data/containers/shared/projection";
import type {
  ContainerMutationAuthor,
  ContainerRekeyApi,
  ContainerRekeyPlan,
  MaterializedContainerRekeyPlan,
} from "../../../data/containers/shared/types";
import { readCanonicalRecord } from "../../../data/keyingCanonicalJson";
import {
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
  requireProjectionUserKeyResolver,
} from "../../../data/keyingProjectionVerification";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  sealRotationKeyring,
  verifyKeyringEntriesForSeal,
} from "./moveRotation";
import {
  containerMutationRequestCore,
  previousPathRequestFields,
  readCanonicalRecordOrNull,
} from "./mutationRequestCore";
import { submitAcknowledgedContainerMutation } from "./mutationSubmit";
import { collectContainerRevokePrincipalPolicies } from "./revoke";
import { resolveRotationContext } from "./rotationContext";
import { buildContainerRotationWraps } from "./rotationWraps";
import {
  refreshedPrincipalPolicies,
  refreshedPrincipalReferences,
} from "./sharePlanCore";

async function buildRekeyRotationArtifacts(input: {
  containerKey: Uint8Array;
  keyringEntriesOverride: readonly ContainerKekKeyringEntry[] | undefined;
  nextContainerKeyEpoch: number;
  predecessorContainerKey: Uint8Array;
  previousContainerId: string;
  targetKek: ContainerKekResponse;
}): Promise<{
  containerKeyEpochId: string;
  keyring: ContainerKekKeyring;
  predecessorBridge: Awaited<
    ReturnType<typeof createContainerKekPredecessorBridge>
  >;
}> {
  const containerKeyEpochId = await resolveContainerKekEpochId({
    containerId: input.previousContainerId,
    keyEpoch: input.nextContainerKeyEpoch,
    keyMaterial: input.containerKey,
  });
  const predecessorBridge = await createContainerKekPredecessorBridge({
    containerId: input.previousContainerId,
    predecessorContainerKey: input.predecessorContainerKey,
    predecessorContainerKeyEpochId: input.targetKek.containerKeyEpochId,
    successorContainerKey: input.containerKey,
    successorContainerKeyEpochId: containerKeyEpochId,
  });
  if (input.keyringEntriesOverride) {
    // A rebuilt override still has to agree with the epochs the projection's
    // signed history commits to; otherwise a repair could seal a forgery.
    await verifyKeyringEntriesForSeal(
      input.previousContainerId,
      input.keyringEntriesOverride,
      input.targetKek,
    );
  }
  const keyring: ContainerKekKeyring = input.keyringEntriesOverride
    ? await sealContainerKekKeyring({
        containerId: input.previousContainerId,
        entries: [
          ...input.keyringEntriesOverride,
          {
            containerKeyEpochId: input.targetKek.containerKeyEpochId,
            keyMaterial: input.predecessorContainerKey,
          },
        ],
        keyEpoch: input.nextContainerKeyEpoch,
        successorContainerKey: input.containerKey,
        successorContainerKeyEpochId: containerKeyEpochId,
      })
    : await sealRotationKeyring({
        containerId: input.previousContainerId,
        currentKek: input.targetKek,
        currentKeyMaterial: input.predecessorContainerKey,
        keyEpoch: input.nextContainerKeyEpoch,
        successorContainerKey: input.containerKey,
        successorContainerKeyEpochId: containerKeyEpochId,
      });
  return { containerKeyEpochId, keyring, predecessorBridge };
}

async function deriveRekeyManifestArtifacts(input: {
  author: ContainerMutationAuthor;
  containerKeyEpochId: string;
  eventId: string | undefined;
  keyring: ContainerKekKeyring;
  parentKek: ReturnType<typeof getParentKekForTarget>;
  predecessorBridge: Awaited<
    ReturnType<typeof createContainerKekPredecessorBridge>
  >;
  previousProjection: ContainerWriterProjectionResponse;
  previousState: ReturnType<typeof readContainerState>;
  referencedPrincipalHeads: readonly ReferencedPrincipalHead[];
  signedAt: string | undefined;
  target: ReturnType<typeof getTargetContainerContext>;
}) {
  const body: ContainerRekeyAccessEventBody = {
    eventType: "container.rekey",
    containerKeyEpochId: input.containerKeyEpochId,
    keyringHash: await computeContainerKekKeyringHash(input.keyring),
    predecessorBridgeHash: await computeContainerKekPredecessorBridgeHash(
      input.predecessorBridge,
    ),
    referencedPrincipalHeads: [...input.referencedPrincipalHeads],
  };
  const { event, eventHash } = await signContainerMutationEvent({
    author: input.author,
    body,
    containerId: input.previousState.containerId,
    dependencyManifestHashes: uniqueSortedManifestHashes(
      input.previousProjection.path,
    ),
    eventId: input.eventId ?? crypto.randomUUID(),
    previousManifestHash: input.target.manifest.manifestHash,
    signedAt: input.signedAt ?? new Date().toISOString(),
  });
  const state = {
    ...input.previousState,
    epoch: input.previousState.epoch + 1,
    previousManifestHash: input.target.manifest.manifestHash,
    eventHash,
    containerKeyEpochId: input.containerKeyEpochId,
    referencedPrincipalHeads: [...input.referencedPrincipalHeads],
  };
  const manifest = await deriveContainerAccessManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const keyEpoch = buildContainerCreateKeyEpoch({
    containerId: input.previousState.containerId,
    containerKeyEpochId: input.containerKeyEpochId,
    eventHash,
    keyEpoch: input.target.kek.containerKeyEpoch + 1,
    manifestHash,
    parentContainerKeyEpochId: input.parentKek?.containerKeyEpochId ?? null,
  });
  return { body, event, eventHash, keyEpoch, manifest, manifestHash, state };
}

/**
 * An explicit container KEK rotation with no membership change. Doubles as
 * the repair operation: passing `keyringEntriesOverride` seals a keyring
 * rebuilt from the bridge log instead of re-opening the served one, so a
 * poisoned snapshot is replaced by ground truth.
 */
interface RekeyPlanInput {
  author: ContainerMutationAuthor;
  eventId?: string | undefined;
  execSql: ExecSql;
  keyringEntriesOverride?: readonly ContainerKekKeyringEntry[] | undefined;
  previousProjection: ContainerWriterProjectionResponse;
  replacementPrincipalPolicy?: VerifiedPrincipalPolicy | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}

async function collectRekeyPrincipalPolicies(
  input: RekeyPlanInput,
  resolveUserKey: ProjectionUserKeyResolver,
): Promise<VerifiedPrincipalPolicy[]> {
  const previousPolicies = await collectContainerRevokePrincipalPolicies({
    execSql: input.execSql,
    previousProjection: input.previousProjection,
    resolveUserKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  return refreshedPrincipalPolicies({
    previousPolicies,
    replacementPrincipalPolicy: input.replacementPrincipalPolicy,
  });
}

export async function buildMaterializedContainerRekeyPlan(
  input: RekeyPlanInput,
): Promise<MaterializedContainerRekeyPlan> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote container rekey",
  );
  const containerKey = crypto.getRandomValues(new Uint8Array(32));
  const {
    parentKek,
    parentKekMaterial,
    predecessorContainerKey,
    previousState,
    target,
  } = await resolveRotationContext(input, "rekey");
  const nextContainerKeyEpoch = target.kek.containerKeyEpoch + 1;
  const { containerKeyEpochId, keyring, predecessorBridge } =
    await buildRekeyRotationArtifacts({
      containerKey,
      keyringEntriesOverride: input.keyringEntriesOverride,
      nextContainerKeyEpoch,
      predecessorContainerKey,
      previousContainerId: previousState.containerId,
      targetKek: target.kek,
    });
  const principalPolicies = await collectRekeyPrincipalPolicies(
    input,
    resolveProjectionUserKey,
  );
  const referencedPrincipalHeads = refreshedPrincipalReferences({
    previousState,
    replacementPrincipalPolicy: input.replacementPrincipalPolicy,
  });
  const { body, event, eventHash, keyEpoch, manifest, manifestHash, state } =
    await deriveRekeyManifestArtifacts({
      author: input.author,
      containerKeyEpochId,
      eventId: input.eventId,
      keyring,
      parentKek,
      predecessorBridge,
      previousProjection: input.previousProjection,
      previousState,
      referencedPrincipalHeads,
      signedAt: input.signedAt,
      target,
    });
  const { userRecipientKeys, wraps } = await buildContainerRotationWraps({
    containerKey,
    containerKeyEpochId,
    manifestHash,
    operationLabel: "Container rekey",
    parentKek,
    parentKekMaterial,
    principalPolicies,
    resolveUserKey: resolveProjectionUserKey,
    state,
  });

  return {
    containerKey,
    plan: buildContainerRekeyPlan({
      body,
      containerId: previousState.containerId,
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
      principalPolicies,
      state,
      userRecipientKeys,
      wraps,
    }),
  };
}

function buildContainerRekeyPlan(input: {
  body: ContainerRekeyAccessEventBody;
  containerId: string;
  containerKeyEpochId: string;
  event: ContainerRekeyPlan["event"];
  eventHash: string;
  keyEpoch: ContainerRekeyPlan["keyEpoch"];
  keyring: ContainerKekKeyring;
  manifest: ContainerRekeyPlan["manifest"];
  manifestHash: string;
  parentKek: ReturnType<typeof getParentKekForTarget>;
  predecessorBridge: Awaited<
    ReturnType<typeof createContainerKekPredecessorBridge>
  >;
  previousManifest: ContainerRekeyPlan["previousManifest"];
  previousProjection: ContainerWriterProjectionResponse;
  principalPolicies: readonly VerifiedPrincipalPolicy[];
  state: ContainerRekeyPlan["state"];
  userRecipientKeys: ContainerRekeyPlan["userRecipientKeys"];
  wraps: ContainerRekeyPlan["wraps"];
}): ContainerRekeyPlan {
  return {
    body: input.body,
    containerId: input.containerId,
    containerKeyEpochId: input.containerKeyEpochId,
    event: input.event,
    eventHash: input.eventHash,
    keyEpoch: input.keyEpoch,
    manifest: input.manifest,
    manifestHash: input.manifestHash,
    previousManifest: input.previousManifest,
    request: {
      ...containerMutationRequestCore("rekey", input),
      ...previousPathRequestFields(
        input.previousManifest,
        input.previousProjection,
      ),
      predecessorBridge: readCanonicalRecord(
        input.predecessorBridge,
        "Container rekey predecessor bridge",
      ),
      keyring: readCanonicalRecord(input.keyring, "Container rekey keyring"),
      parentKekState: readCanonicalRecordOrNull(
        input.parentKek,
        "Container rekey parent KEK state",
      ),
    },
    state: input.state,
    userRecipientKeys: input.userRecipientKeys,
    wraps: input.wraps,
  };
}

export async function rekeyRemoteContainer(input: {
  apiClient: ContainerRekeyApi;
  author: ContainerMutationAuthor;
  containerId: string;
  eventId?: string | undefined;
  execSql: ExecSql;
  keyringEntriesOverride?: readonly ContainerKekKeyringEntry[] | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<{
  containerKey: Uint8Array;
  plan: ContainerRekeyPlan;
  response: ContainerMutationResponse;
} | null> {
  const previousProjection = await input.apiClient.getContainerWriterProjection(
    input.containerId,
  );
  if (!previousProjection) {
    return null;
  }

  const materializedPlan = await buildMaterializedContainerRekeyPlan({
    author: input.author,
    eventId: input.eventId,
    execSql: input.execSql,
    keyringEntriesOverride: input.keyringEntriesOverride,
    previousProjection,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    signedAt: input.signedAt,
    targetSecretKey: input.targetSecretKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  return submitAcknowledgedContainerMutation({
    containerKey: materializedPlan.containerKey,
    execSql: input.execSql,
    plan: materializedPlan.plan,
    submit: () =>
      input.apiClient.rekeyContainer(
        input.containerId,
        materializedPlan.plan.request,
      ),
  });
}
