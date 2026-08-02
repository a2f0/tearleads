import type {
  ContainerKekKeyring,
  ContainerKekKeyringEntry,
  ContainerRekeyAccessEventBody,
} from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  computeContainerKekKeyringHash,
  computeContainerKekPredecessorBridgeHash,
  createContainerKekPredecessorBridge,
  deriveContainerAccessManifest,
  sealContainerKekKeyring,
} from "@tearleads/crypto";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
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

/**
 * An explicit container KEK rotation with no membership change. Doubles as
 * the repair operation: passing `keyringEntriesOverride` seals a keyring
 * rebuilt from the bridge log instead of re-opening the served one, so a
 * poisoned snapshot is replaced by ground truth.
 */
export async function buildMaterializedContainerRekeyPlan(input: {
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
}): Promise<MaterializedContainerRekeyPlan> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote container rekey",
  );
  const containerKey = crypto.getRandomValues(new Uint8Array(32));

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
  const nextContainerKeyEpoch = target.kek.containerKeyEpoch + 1;
  const containerKeyEpochId = await resolveContainerKekEpochId({
    containerId: previousState.containerId,
    keyEpoch: nextContainerKeyEpoch,
    keyMaterial: containerKey,
    override: input.containerKeyEpochId,
  });
  const predecessorBridge = await createContainerKekPredecessorBridge({
    containerId: previousState.containerId,
    predecessorContainerKey,
    predecessorContainerKeyEpochId: target.kek.containerKeyEpochId,
    successorContainerKey: containerKey,
    successorContainerKeyEpochId: containerKeyEpochId,
  });
  const keyring: ContainerKekKeyring = input.keyringEntriesOverride
    ? await sealContainerKekKeyring({
        containerId: previousState.containerId,
        entries: [
          ...input.keyringEntriesOverride,
          {
            containerKeyEpochId: target.kek.containerKeyEpochId,
            keyMaterial: predecessorContainerKey,
          },
        ],
        keyEpoch: nextContainerKeyEpoch,
        successorContainerKey: containerKey,
        successorContainerKeyEpochId: containerKeyEpochId,
      })
    : await sealRotationKeyring({
        containerId: previousState.containerId,
        currentKek: target.kek,
        currentKeyMaterial: predecessorContainerKey,
        keyEpoch: nextContainerKeyEpoch,
        successorContainerKey: containerKey,
        successorContainerKeyEpochId: containerKeyEpochId,
      });
  const body: ContainerRekeyAccessEventBody = {
    eventType: "container.rekey",
    containerKeyEpochId,
    keyringHash: await computeContainerKekKeyringHash(keyring),
    predecessorBridgeHash:
      await computeContainerKekPredecessorBridgeHash(predecessorBridge),
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
  const state = {
    ...previousState,
    epoch: previousState.epoch + 1,
    previousManifestHash: target.manifest.manifestHash,
    eventHash,
    containerKeyEpochId,
  };
  const manifest = await deriveContainerAccessManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
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

  const previousManifest = asContainerManifestBundle(target.manifest);
  const plan: ContainerRekeyPlan = {
    body,
    containerId: previousState.containerId,
    containerKeyEpochId,
    event,
    eventHash,
    keyEpoch,
    manifest,
    manifestHash,
    previousManifest,
    request: {
      event: readCanonicalRecord(event, "Container rekey event"),
      body: readCanonicalRecord(body, "Container rekey body"),
      expectedManifestHash: manifestHash,
      manifest: readCanonicalRecord(manifest, "Container rekey manifest"),
      previousManifest,
      previousContainerPath: input.previousProjection.path.map(
        asContainerManifestBundle,
      ),
      principalPolicies: readCanonicalRecords(
        principalPolicies.map((policy) => principalPolicyRequestRecord(policy)),
        "Container rekey principal policies",
      ),
      keyEpoch: readCanonicalRecord(keyEpoch, "Container rekey key epoch"),
      predecessorBridge: readCanonicalRecord(
        predecessorBridge,
        "Container rekey predecessor bridge",
      ),
      keyring: readCanonicalRecord(keyring, "Container rekey keyring"),
      wraps: readCanonicalRecords(wraps, "Container rekey wraps"),
      parentKekState:
        parentKek === null
          ? null
          : readCanonicalRecord(parentKek, "Container rekey parent KEK state"),
      userRecipientKeys: readCanonicalRecords(
        userRecipientKeys,
        "Container rekey user recipient keys",
      ),
    },
    state,
    userRecipientKeys,
    wraps,
  };

  return { containerKey, plan };
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
