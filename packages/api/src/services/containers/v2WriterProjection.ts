import type {
  AccessManifestV2,
  ContainerAccessManifestStateV2,
  ContainerKekRecipientTargetV2,
  ContainerKeyEpochV2,
  ContainerKeyWrapV2,
  KeyingV2CanonicalJson,
  VerifiedContainerAccessManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  resolveContainerPathUserAccessLevel,
} from "@tearleads/crypto";
import type {
  ContainerV2KekResponse,
  ContainerV2ManifestBundleResponse,
  ContainerV2WriterProjectionResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  getAccessManifestBundle,
  getCurrentAccessManifestHead,
} from "../../access/accessManifestStore";
import {
  getContainerKeyEpochById,
  listContainerKeyWraps,
} from "../../access/containerKekStore";
import type { DatabaseExecutor } from "../../adapters/postgres";
import { containers } from "../../schema";
import {
  loadPrincipalPoliciesForContainerPaths,
  PrincipalPolicyProjectionError,
} from "../documents/principalPolicyProjection";
import type { ApiServiceRuntime } from "../runtime";

type ContainerV2WriterProjectionStatus = 403 | 404 | 409;

export class ContainerV2WriterProjectionError extends Error {
  constructor(
    message: string,
    readonly status: ContainerV2WriterProjectionStatus,
  ) {
    super(message);
    this.name = "ContainerV2WriterProjectionError";
  }
}

interface ContainerPathRow {
  readonly id: string;
  readonly organizationId: string;
  readonly parentId: string | null;
}

function toManifestBundleResponse(input: {
  readonly event: Record<string, unknown>;
  readonly manifest: AccessManifestV2;
  readonly manifestHash: string;
  readonly state: KeyingV2CanonicalJson;
}): ContainerV2ManifestBundleResponse {
  return {
    event: input.event,
    manifest: input.manifest as unknown as Record<string, unknown>,
    manifestHash: input.manifestHash,
    state: input.state as Record<string, unknown>,
  };
}

function toVerifiedContainerManifest(
  bundle: ContainerV2ManifestBundleResponse,
): VerifiedContainerAccessManifest {
  return {
    ...bundle,
    state: readContainerAccessState(bundle),
  } as unknown as VerifiedContainerAccessManifest;
}

function readContainerAccessState(
  bundle: ContainerV2ManifestBundleResponse,
): ContainerAccessManifestStateV2 {
  const record =
    bundle.state as unknown as Partial<ContainerAccessManifestStateV2>;
  const manifest = bundle.manifest as Partial<AccessManifestV2>;

  if (
    record.version !== 2 ||
    typeof record.containerId !== "string" ||
    record.containerId.length === 0 ||
    typeof record.organizationId !== "string" ||
    record.organizationId.length === 0 ||
    typeof record.epoch !== "number" ||
    !Number.isInteger(record.epoch) ||
    record.epoch <= 0 ||
    !("parentContainerId" in record) ||
    (record.parentContainerId !== null &&
      typeof record.parentContainerId !== "string") ||
    typeof record.eventHash !== "string" ||
    record.eventHash.length === 0 ||
    typeof record.metadataDocumentId !== "string" ||
    record.metadataDocumentId.length === 0 ||
    !("previousManifestHash" in record) ||
    (record.previousManifestHash !== null &&
      typeof record.previousManifestHash !== "string") ||
    typeof record.containerKeyEpochId !== "string" ||
    record.containerKeyEpochId.length === 0 ||
    !Array.isArray(record.directGrants) ||
    !Array.isArray(record.referencedPrincipalHeads)
  ) {
    throw new ContainerV2WriterProjectionError(
      "Container V2 manifest state is invalid",
      409,
    );
  }

  if (
    manifest.objectKind !== "container" ||
    manifest.objectId !== record.containerId ||
    manifest.organizationId !== record.organizationId ||
    manifest.epoch !== record.epoch ||
    manifest.eventHash !== record.eventHash ||
    manifest.previousManifestHash !== record.previousManifestHash
  ) {
    throw new ContainerV2WriterProjectionError(
      "Container V2 manifest state mismatch",
      409,
    );
  }

  return record as ContainerAccessManifestStateV2;
}

function containerKeyWrapTarget(
  wrap: ContainerKeyWrapV2,
): ContainerKekRecipientTargetV2 {
  return {
    recipientKind: wrap.recipientKind,
    recipientId: wrap.recipientId,
    recipientKeyEpochId: wrap.recipientKeyEpochId,
    recipientKeyFingerprint: wrap.recipientKeyFingerprint,
  };
}

function stripContainerKeyEpoch(
  keyEpoch: ContainerKeyEpochV2,
): ContainerKeyEpochV2 {
  return {
    id: keyEpoch.id,
    containerId: keyEpoch.containerId,
    keyEpoch: keyEpoch.keyEpoch,
    accessManifestHash: keyEpoch.accessManifestHash,
    parentContainerKeyEpochId: keyEpoch.parentContainerKeyEpochId,
    createdByEventHash: keyEpoch.createdByEventHash,
    createdByManifestHash: keyEpoch.createdByManifestHash,
  };
}

function stripContainerKeyWrap(wrap: ContainerKeyWrapV2): ContainerKeyWrapV2 {
  return {
    containerKeyEpochId: wrap.containerKeyEpochId,
    recipientKind: wrap.recipientKind,
    recipientId: wrap.recipientId,
    recipientKeyEpochId: wrap.recipientKeyEpochId,
    recipientKeyFingerprint: wrap.recipientKeyFingerprint,
    kemCipherText: wrap.kemCipherText,
    wrappedKey: wrap.wrappedKey,
    wrapManifestHash: wrap.wrapManifestHash,
  };
}

async function loadContainerPath(
  executor: DatabaseExecutor,
  containerId: string,
): Promise<ContainerPathRow[]> {
  const path: ContainerPathRow[] = [];
  const seenContainerIds = new Set<string>();
  let currentContainerId: string | null = containerId;

  while (currentContainerId !== null) {
    if (seenContainerIds.has(currentContainerId)) {
      throw new ContainerV2WriterProjectionError(
        "Container path contains a cycle",
        409,
      );
    }
    seenContainerIds.add(currentContainerId);

    const [row] = await executor
      .select({
        id: containers.id,
        organizationId: containers.organizationId,
        parentId: containers.parentId,
      })
      .from(containers)
      .where(eq(containers.id, currentContainerId))
      .limit(1);

    if (!row) {
      throw new ContainerV2WriterProjectionError("Container not found", 404);
    }

    path.push(row);
    currentContainerId = row.parentId;
  }

  return path.reverse();
}

async function loadCurrentContainerManifestBundle(
  executor: DatabaseExecutor,
  containerId: string,
): Promise<ContainerV2ManifestBundleResponse> {
  const head = await getCurrentAccessManifestHead(
    "container",
    containerId,
    executor,
  );
  if (!head) {
    throw new ContainerV2WriterProjectionError(
      "Container V2 manifest head missing",
      409,
    );
  }

  const bundle = await getAccessManifestBundle(head.manifestHash, executor);
  if (!bundle || bundle.manifest.objectKind !== "container") {
    throw new ContainerV2WriterProjectionError(
      "Container V2 manifest bundle missing",
      409,
    );
  }

  return toManifestBundleResponse({
    event: bundle.event as unknown as Record<string, unknown>,
    manifest: bundle.manifest,
    manifestHash: bundle.manifestHash,
    state: bundle.state,
  });
}

async function loadContainerKekResponse(
  executor: DatabaseExecutor,
  manifest: VerifiedContainerAccessManifest,
): Promise<ContainerV2KekResponse> {
  const containerKeyEpochId = manifest.state.containerKeyEpochId;
  if (!containerKeyEpochId) {
    throw new ContainerV2WriterProjectionError(
      "Container V2 KEK state missing",
      409,
    );
  }

  const storedKeyEpoch = await getContainerKeyEpochById(
    containerKeyEpochId,
    executor,
  );
  if (!storedKeyEpoch) {
    throw new ContainerV2WriterProjectionError(
      "Container V2 KEK epoch missing",
      409,
    );
  }
  if (storedKeyEpoch.containerId !== manifest.state.containerId) {
    throw new ContainerV2WriterProjectionError(
      "Container V2 KEK epoch is stale",
      409,
    );
  }

  const keyEpoch = stripContainerKeyEpoch(storedKeyEpoch);
  const wraps = (
    await listContainerKeyWraps(containerKeyEpochId, executor)
  ).map(stripContainerKeyWrap);
  const recipientTargets = wraps.map(containerKeyWrapTarget);

  return {
    containerId: manifest.state.containerId,
    accessManifestHash: manifest.manifestHash,
    containerKeyEpochId,
    containerKeyEpoch: keyEpoch.keyEpoch,
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
    keyTargetHash:
      await computeContainerKekRecipientTargetHash(recipientTargets),
    parentContainerKeyEpochId: keyEpoch.parentContainerKeyEpochId,
    recipientTargets: recipientTargets as unknown as Record<string, unknown>[],
    wraps: wraps as unknown as Record<string, unknown>[],
  };
}

export async function resolveContainerV2WriterProjection(input: {
  readonly containerId: string;
  readonly executor: DatabaseExecutor;
  readonly userId: string;
}): Promise<ContainerV2WriterProjectionResponse> {
  const pathRows = await loadContainerPath(input.executor, input.containerId);
  const path = await Promise.all(
    pathRows.map((row) =>
      loadCurrentContainerManifestBundle(input.executor, row.id),
    ),
  );
  const verifiedPath = path.map(toVerifiedContainerManifest);
  let principalPolicies: VerifiedPrincipalPolicy[];
  try {
    principalPolicies = await loadPrincipalPoliciesForContainerPaths(
      input.executor,
      [verifiedPath],
    );
  } catch (error) {
    if (error instanceof PrincipalPolicyProjectionError) {
      throw new ContainerV2WriterProjectionError(error.message, error.status);
    }
    throw error;
  }
  const accessLevel = resolveContainerPathUserAccessLevel({
    path: verifiedPath,
    principalPolicies,
    userId: input.userId,
  });

  if (accessLevel !== "write" && accessLevel !== "admin") {
    throw new ContainerV2WriterProjectionError("Forbidden", 403);
  }

  const containerKeks = await Promise.all(
    verifiedPath.map((manifest) =>
      loadContainerKekResponse(input.executor, manifest),
    ),
  );
  const targetManifest = verifiedPath.at(-1);
  if (!targetManifest) {
    throw new ContainerV2WriterProjectionError("Container not found", 404);
  }

  return {
    containerId: input.containerId,
    organizationId: targetManifest.state.organizationId,
    path,
    containerKeks,
  };
}

export async function getContainerV2WriterProjection(
  runtime: ApiServiceRuntime,
  input: {
    readonly containerId: string;
    readonly userId: string;
  },
): Promise<ContainerV2WriterProjectionResponse> {
  return runtime.db.transaction((tx) =>
    resolveContainerV2WriterProjection({
      containerId: input.containerId,
      executor: tx,
      userId: input.userId,
    }),
  );
}
