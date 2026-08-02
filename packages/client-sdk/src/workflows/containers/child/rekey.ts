import type {
  ContainerKekKeyring,
  ContainerKekKeyringEntry,
  ContainerRekeyAccessEventBody,
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
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  buildContainerCreateKeyEpoch,
  resolveContainerKekEpochId,
  signContainerMutationEvent,
} from "../../../data/containers/shared/events";
import { acknowledgeContainerMutation } from "../../../data/containers/shared/mutationAcknowledgement";
import { principalPolicyRequestRecord } from "../../../data/containers/shared/principalPolicies";
import {
  asContainerManifestBundle,
  getParentKekForTarget,
  getTargetContainerContext,
  readContainerState,
  uniqueSortedManifestHashes,
} from "../../../data/containers/shared/projection";
import type {
  ContainerMutationAuthor,
  ContainerRekeyApi,
  ContainerRekeyPlan,
  MaterializedContainerRekeyPlan,
} from "../../../data/containers/shared/types";
import { unwrapContainerKekPath } from "../../../data/documents/shared/projection";
import { projectionVerificationOptions } from "../../../data/documents/shared/types";
import {
  readCanonicalRecord,
  readCanonicalRecords,
} from "../../../data/keyingCanonicalJson";
import {
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
  requireProjectionUserKeyResolver,
} from "../../../data/keyingProjectionVerification";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { sealRotationKeyring } from "./moveRotation";
import { collectContainerRevokePrincipalPolicies } from "./revoke";
import { buildContainerRotationWraps } from "./rotationWraps";

async function buildRekeyRotationArtifacts(input: {
  containerKey: Uint8Array;
  keyringEntriesOverride: readonly ContainerKekKeyringEntry[] | undefined;
  nextContainerKeyEpoch: number;
  override: string | undefined;
  predecessorContainerKey: Uint8Array;
  previousContainerId: string;
  targetKek: ReturnType<typeof getTargetContainerContext>["kek"];
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
    override: input.override,
  });
  const predecessorBridge = await createContainerKekPredecessorBridge({
    containerId: input.previousContainerId,
    predecessorContainerKey: input.predecessorContainerKey,
    predecessorContainerKeyEpochId: input.targetKek.containerKeyEpochId,
    successorContainerKey: input.containerKey,
    successorContainerKeyEpochId: containerKeyEpochId,
  });
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
  };
  const manifest = await deriveContainerAccessManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const keyEpoch = buildContainerCreateKeyEpoch({
    containerId: input.previousState.containerId,
    containerKeyEpochId: input.containerKeyEpochId,
    eventHash,
    manifestHash,
    parentContainerKeyEpochId: input.parentKek?.containerKeyEpochId ?? null,
  });
  keyEpoch.keyEpoch = input.target.kek.containerKeyEpoch + 1;
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
  containerKeyEpochId?: string | undefined;
  eventId?: string | undefined;
  execSql: ExecSql;
  keyringEntriesOverride?: readonly ContainerKekKeyringEntry[] | undefined;
  previousProjection: ContainerWriterProjectionResponse;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}

async function resolveRekeyContext(input: RekeyPlanInput): Promise<{
  parentKek: ReturnType<typeof getParentKekForTarget>;
  parentKekMaterial: Uint8Array | null;
  predecessorContainerKey: Uint8Array;
  previousState: ReturnType<typeof readContainerState>;
  target: ReturnType<typeof getTargetContainerContext>;
}> {
  const keksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    projection: input.previousProjection,
    secretKey: input.targetSecretKey,
    ...projectionVerificationOptions(input),
  });
  const target = getTargetContainerContext(input.previousProjection);
  const predecessorContainerKey = keksByEpochId.get(
    target.kek.containerKeyEpochId,
  );
  if (!predecessorContainerKey) {
    throw new Error("Container rekey predecessor KEK could not be unwrapped");
  }
  const previousState = readContainerState(target.manifest);
  if (previousState.organizationId !== input.author.organizationId) {
    throw new Error("Container rekey author organization mismatch");
  }

  const parentKek = getParentKekForTarget(input.previousProjection);
  const parentKekMaterial = parentKek
    ? (keksByEpochId.get(parentKek.containerKeyEpochId) ?? null)
    : null;
  return {
    parentKek,
    parentKekMaterial,
    predecessorContainerKey,
    previousState,
    target,
  };
}

async function buildMaterializedContainerRekeyPlan(
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
  } = await resolveRekeyContext(input);
  const nextContainerKeyEpoch = target.kek.containerKeyEpoch + 1;
  const { containerKeyEpochId, keyring, predecessorBridge } =
    await buildRekeyRotationArtifacts({
      containerKey,
      keyringEntriesOverride: input.keyringEntriesOverride,
      nextContainerKeyEpoch,
      override: input.containerKeyEpochId,
      predecessorContainerKey,
      previousContainerId: previousState.containerId,
      targetKek: target.kek,
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
      signedAt: input.signedAt,
      target,
    });
  const principalPolicies = await collectContainerRevokePrincipalPolicies({
    execSql: input.execSql,
    previousProjection: input.previousProjection,
    resolveUserKey: resolveProjectionUserKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
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
      event: readCanonicalRecord(input.event, "Container rekey event"),
      body: readCanonicalRecord(input.body, "Container rekey body"),
      expectedManifestHash: input.manifestHash,
      manifest: readCanonicalRecord(input.manifest, "Container rekey manifest"),
      previousManifest: input.previousManifest,
      previousContainerPath: input.previousProjection.path.map(
        asContainerManifestBundle,
      ),
      principalPolicies: readCanonicalRecords(
        input.principalPolicies.map((policy) =>
          principalPolicyRequestRecord(policy),
        ),
        "Container rekey principal policies",
      ),
      keyEpoch: readCanonicalRecord(
        input.keyEpoch,
        "Container rekey key epoch",
      ),
      predecessorBridge: readCanonicalRecord(
        input.predecessorBridge,
        "Container rekey predecessor bridge",
      ),
      keyring: readCanonicalRecord(input.keyring, "Container rekey keyring"),
      wraps: readCanonicalRecords(input.wraps, "Container rekey wraps"),
      parentKekState:
        input.parentKek === null
          ? null
          : readCanonicalRecord(
              input.parentKek,
              "Container rekey parent KEK state",
            ),
      userRecipientKeys: readCanonicalRecords(
        input.userRecipientKeys,
        "Container rekey user recipient keys",
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
  const response = await input.apiClient.rekeyContainer(
    input.containerId,
    materializedPlan.plan.request,
  );
  if (!response) {
    return null;
  }

  await acknowledgeContainerMutation({
    execSql: input.execSql,
    plan: materializedPlan.plan,
    response,
  });

  return {
    containerKey: materializedPlan.containerKey,
    plan: materializedPlan.plan,
    response,
  };
}
