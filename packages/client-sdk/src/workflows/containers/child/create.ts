import {
  type AccessEvent,
  type AccessManifest,
  type ContainerCreateAccessEventBody,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type {
  ContainerKekResponse,
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  buildContainerCreateBody,
  buildContainerCreateKeyEpoch,
  buildParentRecipientTargets,
  deriveContainerCreateManifest,
  resolveContainerKekEpochId,
  signContainerCreateEvent,
} from "../../../data/containers/shared/events";
import { principalPolicyRequestRecord } from "../../../data/containers/shared/principalPolicies";
import {
  asContainerManifestBundle,
  getParentCreateContext,
  wrapContainerKeyToParent,
} from "../../../data/containers/shared/projection";
import type {
  BuildContainerCreatePlanInput,
  ContainerCreateApi,
  ContainerCreatePlan,
  ContainerCreatePlanContext,
  ContainerMutationAuthor,
  ContainerMutationSubmitFailure,
  CreateRemoteContainerResult,
  MaterializedContainerCreatePlan,
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
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import {
  collectContainerWriterProjectionPrincipalPolicies,
  requireProjectionUserKeyResolver,
} from "../../../data/keyingProjectionVerification";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { cachePrincipalPolicyBundles } from "../../principals/policyCache";

function assertContainerCreatePlanInput(input: {
  author: ContainerMutationAuthor;
  containerKey: Uint8Array;
  parentKekMaterial: Uint8Array;
  parentProjection: ContainerWriterProjectionResponse;
}): void {
  if (input.containerKey.byteLength !== 32) {
    throw new Error("Container KEK material must be 32 bytes");
  }
  if (input.parentKekMaterial.byteLength !== 32) {
    throw new Error("Container parent KEK material must be 32 bytes");
  }
  if (input.author.organizationId !== input.parentProjection.organizationId) {
    throw new Error(
      "Container author organization does not match parent projection",
    );
  }
}

function buildContainerCreateRequest(input: {
  body: ContainerCreateAccessEventBody;
  event: AccessEvent;
  keyEpoch: ContainerKeyEpoch;
  manifest: AccessManifest;
  manifestHash: string;
  parentKek: ContainerKekResponse;
  parentProjection: ContainerWriterProjectionResponse;
  principalPolicies: readonly VerifiedPrincipalPolicy[];
  wraps: readonly ContainerKeyWrap[];
}): ContainerMutationRequest {
  return {
    event: readCanonicalRecord(input.event, "Container create event"),
    body: readCanonicalRecord(input.body, "Container create body"),
    expectedManifestHash: input.manifestHash,
    manifest: readCanonicalRecord(input.manifest, "Container create manifest"),
    previousManifest: null,
    parentContainerPath: input.parentProjection.path.map(
      asContainerManifestBundle,
    ),
    principalPolicies: readCanonicalRecords(
      input.principalPolicies.map((policy) =>
        principalPolicyRequestRecord(policy),
      ),
      "Container create principal policies",
    ),
    keyEpoch: readCanonicalRecord(input.keyEpoch, "Container create key epoch"),
    wraps: readCanonicalRecords(input.wraps, "Container create wraps"),
    parentKekState: readCanonicalRecord(
      input.parentKek,
      "Container create parent KEK state",
    ),
    userRecipientKeys: [],
  };
}

async function resolveContainerCreatePlanContext(
  input: BuildContainerCreatePlanInput,
): Promise<ContainerCreatePlanContext> {
  assertContainerCreatePlanInput(input);
  const containerId = input.containerId ?? crypto.randomUUID();

  return {
    ...input,
    containerId,
    containerKeyEpochId: await resolveContainerKekEpochId({
      containerId,
      keyEpoch: 1,
      keyMaterial: input.containerKey,
      override: input.containerKeyEpochId,
    }),
    eventId: input.eventId ?? crypto.randomUUID(),
    metadataDocumentId: input.metadataDocumentId ?? crypto.randomUUID(),
    parent: getParentCreateContext(input.parentProjection),
    signedAt: input.signedAt ?? new Date().toISOString(),
  };
}

export async function buildContainerCreatePlan(
  input: BuildContainerCreatePlanInput,
): Promise<ContainerCreatePlan> {
  const context = await resolveContainerCreatePlanContext(input);
  const parentContainerId = context.parentProjection.containerId;
  const parentManifestHash = context.parent.manifest.manifestHash;
  const body = buildContainerCreateBody({
    containerKeyEpochId: context.containerKeyEpochId,
    metadataDocumentId: context.metadataDocumentId,
    parentContainerId,
    parentManifestHash,
  });
  const { event, eventHash } = await signContainerCreateEvent({
    author: context.author,
    body,
    containerId: context.containerId,
    eventId: context.eventId,
    parentPath: context.parentProjection.path,
    signedAt: context.signedAt,
  });
  const { manifest, manifestHash, state } = await deriveContainerCreateManifest(
    {
      author: context.author,
      containerId: context.containerId,
      containerKeyEpochId: context.containerKeyEpochId,
      eventHash,
      metadataDocumentId: context.metadataDocumentId,
      parentContainerId,
      parentManifestHash,
    },
  );
  const keyEpoch = buildContainerCreateKeyEpoch({
    containerId: context.containerId,
    containerKeyEpochId: context.containerKeyEpochId,
    eventHash,
    manifestHash,
    parentContainerKeyEpochId: context.parent.kek.containerKeyEpochId,
  });
  const recipientTargets = buildParentRecipientTargets(context.parent.kek);
  const keyTargetHash =
    await computeContainerKekRecipientTargetHash(recipientTargets);
  const keyEpochHash = await computeContainerKeyEpochHash(keyEpoch);
  const wraps = [
    await wrapContainerKeyToParent({
      containerKey: context.containerKey,
      containerKeyEpochId: context.containerKeyEpochId,
      manifestHash,
      parentKek: context.parent.kek,
      parentKekMaterial: context.parentKekMaterial,
    }),
  ];
  return {
    body,
    containerId: context.containerId,
    containerKeyEpochId: context.containerKeyEpochId,
    event,
    eventHash,
    keyEpoch,
    keyEpochHash,
    keyTargetHash,
    manifest,
    manifestHash,
    metadataDocumentId: context.metadataDocumentId,
    parentContainerId,
    parentManifestHash,
    recipientTargets,
    request: buildContainerCreateRequest({
      body,
      event,
      keyEpoch,
      manifest,
      manifestHash,
      parentKek: context.parent.kek,
      parentProjection: context.parentProjection,
      principalPolicies: context.principalPolicies ?? [],
      wraps,
    }),
    state,
    wraps,
  };
}

export async function buildMaterializedContainerCreatePlan(
  input: {
    author: ContainerMutationAuthor;
    containerId?: string | undefined;
    containerKey?: Uint8Array | undefined;
    containerKeyEpochId?: string | undefined;
    eventId?: string | undefined;
    execSql?: ExecSql | undefined;
    metadataDocumentId?: string | undefined;
    parentProjection: ContainerWriterProjectionResponse;
    parentSecretKey: Uint8Array;
    signedAt?: string | undefined;
  } & ProjectionVerificationOptions,
): Promise<MaterializedContainerCreatePlan> {
  const containerKey =
    input.containerKey ?? crypto.getRandomValues(new Uint8Array(32));

  const parentKeksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    projection: input.parentProjection,
    secretKey: input.parentSecretKey,
    ...projectionVerificationOptions(input),
  });
  const parent = getParentCreateContext(input.parentProjection);
  const parentKekMaterial = parentKeksByEpochId.get(
    parent.kek.containerKeyEpochId,
  );
  if (!parentKekMaterial) {
    throw new Error("Container parent KEK could not be unwrapped");
  }
  const principalPolicies = input.resolveProjectionUserKey
    ? await collectContainerWriterProjectionPrincipalPolicies({
        execSql: input.execSql,
        projection: input.parentProjection,
        resolveUserKey: input.resolveProjectionUserKey,
      })
    : [];

  const plan = await buildContainerCreatePlan({
    author: input.author,
    containerId: input.containerId,
    containerKey,
    containerKeyEpochId: input.containerKeyEpochId,
    eventId: input.eventId,
    metadataDocumentId: input.metadataDocumentId,
    parentKekMaterial,
    parentProjection: input.parentProjection,
    principalPolicies,
    signedAt: input.signedAt,
  });

  return {
    containerKey,
    plan,
  };
}

export function childContainerWriterProjectionFromCreatePlan(input: {
  materializedPlan: MaterializedContainerCreatePlan;
  parentProjection: ContainerWriterProjectionResponse;
}): ContainerWriterProjectionResponse {
  const { materializedPlan, parentProjection } = input;
  const { plan } = materializedPlan;
  const parentKek = getParentCreateContext(parentProjection).kek;

  return {
    containerId: plan.containerId,
    organizationId: plan.state.organizationId,
    path: [
      ...parentProjection.path,
      {
        event: {
          event: readCanonicalRecord(plan.event, "Container child event"),
          body: readCanonicalRecord(plan.body, "Container child body"),
          eventHash: plan.eventHash,
        },
        manifest: readCanonicalRecord(
          plan.manifest,
          "Container child manifest",
        ),
        manifestHash: plan.manifestHash,
        state: readCanonicalRecord(plan.state, "Container child state"),
      },
    ],
    containerKeks: [
      ...parentProjection.containerKeks,
      {
        containerId: plan.containerId,
        accessManifestHash: plan.manifestHash,
        containerKeyEpochId: plan.containerKeyEpochId,
        containerKeyEpoch: plan.keyEpoch.keyEpoch,
        keyEpoch: readCanonicalRecord(
          plan.keyEpoch,
          "Container child key epoch",
        ),
        keyEpochHash: plan.keyEpochHash,
        keyTargetHash: plan.keyTargetHash,
        parentContainerKeyEpochId: parentKek.containerKeyEpochId,
        recipientTargets: readCanonicalRecords(
          plan.recipientTargets,
          "Container child recipient targets",
        ),
        wraps: readCanonicalRecords(plan.wraps, "Container child wraps"),
      },
    ],
  };
}

async function submitRemoteContainerCreate(input: {
  readonly apiClient: ContainerCreateApi;
  readonly plan: ContainerCreatePlan;
}): Promise<
  | {
      readonly ok: true;
      readonly response: ContainerMutationResponse;
    }
  | ContainerMutationSubmitFailure
  | null
> {
  if (input.apiClient.createContainerResult) {
    const result = await input.apiClient.createContainerResult(
      input.plan.request,
      { reportErrors: false },
    );

    return result.ok ? { ok: true, response: result.data } : result;
  }

  const response = await input.apiClient.createContainer(input.plan.request);
  return response ? { ok: true, response } : null;
}

async function cacheRemoteContainerCreatePolicyRepair(input: {
  readonly apiClient: ContainerCreateApi;
  readonly execSql: ExecSql | undefined;
  readonly failure: ContainerMutationSubmitFailure;
  readonly organizationId: string;
}): Promise<boolean> {
  const bundles = input.failure.stalePrincipalPolicies;
  const getCurrentPrincipalPolicy = input.apiClient.getCurrentPrincipalPolicy;
  const getEncapsulationKey = input.apiClient.getEncapsulationKey;
  if (
    !input.execSql ||
    !bundles ||
    bundles.length === 0 ||
    !getCurrentPrincipalPolicy ||
    !getEncapsulationKey
  ) {
    return false;
  }

  // The server supplied fresh signed policy bundles with the 409. Verify and
  // cache them locally before rebuilding the signed create request.
  await cachePrincipalPolicyBundles({
    bundles,
    execSql: input.execSql,
    getCurrentPrincipalPolicy,
    getEncapsulationKey,
    organizationId: input.organizationId,
  });
  return true;
}

export async function createRemoteContainer(input: {
  apiClient: ContainerCreateApi;
  author: ContainerMutationAuthor;
  containerId?: string | undefined;
  containerKey?: Uint8Array | undefined;
  containerKeyEpochId?: string | undefined;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  metadataDocumentId?: string | undefined;
  parentContainerId: string;
  parentProjection?: ContainerWriterProjectionResponse | undefined;
  parentSecretKey: Uint8Array;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
}): Promise<CreateRemoteContainerResult | null> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote container create",
  );
  const parentProjection =
    input.parentProjection ??
    (await input.apiClient.getContainerWriterProjection(
      input.parentContainerId,
    ));
  if (!parentProjection) {
    return null;
  }

  const maxAttempts = input.apiClient.createContainerResult ? 2 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const materializedPlan = await buildMaterializedContainerCreatePlan({
      author: input.author,
      containerId: input.containerId,
      containerKey: input.containerKey,
      containerKeyEpochId: input.containerKeyEpochId,
      eventId: input.eventId,
      execSql: input.execSql,
      metadataDocumentId: input.metadataDocumentId,
      parentProjection,
      parentSecretKey: input.parentSecretKey,
      resolveProjectionUserKey,
      signedAt: input.signedAt,
    });
    const submitted = await submitRemoteContainerCreate({
      apiClient: input.apiClient,
      plan: materializedPlan.plan,
    });
    if (!submitted) {
      return null;
    }

    if (!submitted.ok) {
      if (
        attempt < maxAttempts &&
        (await cacheRemoteContainerCreatePolicyRepair({
          apiClient: input.apiClient,
          execSql: input.execSql,
          failure: submitted,
          organizationId: input.author.organizationId,
        }))
      ) {
        // Rebuild after caching the current signed policy bundle; the rejected
        // request was signed against stale policy material and cannot be replayed.
        continue;
      }

      submitted.report();
      return null;
    }

    return {
      containerKey: materializedPlan.containerKey,
      containerId: submitted.response.containerId,
      metadataDocumentId: materializedPlan.plan.metadataDocumentId,
      plan: materializedPlan.plan,
      response: submitted.response,
    };
  }

  return null;
}
