import type {
  AccessManifestV2,
  ContainerAccessLevelV2,
  ContainerAccessManifestStateV2,
  ContainerDirectGrantV2,
  ContainerGrantSubjectTypeV2,
  ContainerKekRecipientTargetV2,
  ContainerKeyEpochV2,
  ContainerKeyWrapV2,
  KeyingV2CanonicalJson,
  ReferencedPrincipalHeadV2,
  VerifiedAccessEvent,
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
import {
  projectionAccessManifestRecord,
  projectionVerifiedAccessEventRecord,
  readProjectionAccessManifest,
  readProjectionNullableString,
  readProjectionPlainRecord,
  readProjectionPositiveInteger,
  readProjectionRecord,
  readProjectionReferencedPrincipalHeads,
  readProjectionString,
  readProjectionValue,
  readProjectionVerifiedAccessEvent,
  readProjectionVersion2,
} from "../keyingV2ProjectionRecords";
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

function projectionError(message: string): ContainerV2WriterProjectionError {
  return new ContainerV2WriterProjectionError(message, 409);
}

function readPlainRecord(value: unknown, label: string) {
  return readProjectionPlainRecord(value, label, projectionError);
}

function readCanonicalRecord(value: KeyingV2CanonicalJson, label: string) {
  return readProjectionRecord(value, label, projectionError);
}

function readString(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  return readProjectionString(record, key, label, projectionError);
}

function readNullableString(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  return readProjectionNullableString(record, key, label, projectionError);
}

function readPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  return readProjectionPositiveInteger(record, key, label, projectionError);
}

function readVersion2(record: Record<string, unknown>, label: string) {
  return readProjectionVersion2(record, label, projectionError);
}

const readValue = readProjectionValue;
const accessManifestRecord = projectionAccessManifestRecord;
const verifiedAccessEventRecord = projectionVerifiedAccessEventRecord;

function readAccessManifest(value: unknown, label: string) {
  return readProjectionAccessManifest(value, label, projectionError);
}

function readVerifiedAccessEvent(value: unknown, label: string) {
  return readProjectionVerifiedAccessEvent(value, label, projectionError);
}

function readReferencedPrincipalHeads(value: unknown, label: string) {
  return readProjectionReferencedPrincipalHeads(value, label, projectionError);
}

function isContainerAccessLevel(
  value: unknown,
): value is ContainerAccessLevelV2 {
  return value === "admin" || value === "read" || value === "write";
}

function isContainerGrantSubjectType(
  value: unknown,
): value is ContainerGrantSubjectTypeV2 {
  return value === "group" || value === "organization" || value === "user";
}

function readContainerDirectGrant(
  value: unknown,
  label: string,
): ContainerDirectGrantV2 {
  const record = readPlainRecord(value, label);
  const accessLevel = readValue(record, "accessLevel");
  const subjectType = readValue(record, "subjectType");
  if (!isContainerAccessLevel(accessLevel)) {
    throw projectionError(`${label}.accessLevel is invalid`);
  }
  if (!isContainerGrantSubjectType(subjectType)) {
    throw projectionError(`${label}.subjectType is invalid`);
  }

  return {
    subjectType,
    subjectId: readString(record, "subjectId", label),
    accessLevel,
  };
}

function readContainerDirectGrants(
  value: unknown,
  label: string,
): ContainerDirectGrantV2[] {
  if (!Array.isArray(value)) {
    throw projectionError(`${label} is invalid`);
  }
  return value.map((entry, index) =>
    readContainerDirectGrant(entry, `${label}[${index}]`),
  );
}

interface ContainerAccessStateFields {
  readonly containerId: string;
  readonly containerKeyEpochId: string;
  readonly directGrants: ContainerDirectGrantV2[];
  readonly epoch: number;
  readonly eventHash: string;
  readonly metadataDocumentId: string;
  readonly organizationId: string;
  readonly parentContainerId: string | null;
  readonly parentManifestHash: string | null;
  readonly previousManifestHash: string | null;
  readonly referencedPrincipalHeads: ReferencedPrincipalHeadV2[];
}

function readContainerAccessStateFields(
  record: Record<string, unknown>,
): ContainerAccessStateFields {
  readVersion2(record, "Container V2 manifest state");

  return {
    containerId: readString(
      record,
      "containerId",
      "Container V2 manifest state",
    ),
    organizationId: readString(
      record,
      "organizationId",
      "Container V2 manifest state",
    ),
    epoch: readPositiveInteger(record, "epoch", "Container V2 manifest state"),
    previousManifestHash: readNullableString(
      record,
      "previousManifestHash",
      "Container V2 manifest state",
    ),
    eventHash: readString(record, "eventHash", "Container V2 manifest state"),
    parentContainerId: readNullableString(
      record,
      "parentContainerId",
      "Container V2 manifest state",
    ),
    parentManifestHash: readNullableString(
      record,
      "parentManifestHash",
      "Container V2 manifest state",
    ),
    metadataDocumentId: readString(
      record,
      "metadataDocumentId",
      "Container V2 manifest state",
    ),
    containerKeyEpochId: readString(
      record,
      "containerKeyEpochId",
      "Container V2 manifest state",
    ),
    directGrants: readContainerDirectGrants(
      readValue(record, "directGrants"),
      "Container V2 manifest state.directGrants",
    ),
    referencedPrincipalHeads: readReferencedPrincipalHeads(
      readValue(record, "referencedPrincipalHeads"),
      "Container V2 manifest state.referencedPrincipalHeads",
    ),
  };
}

function assertContainerManifestMatchesState(
  manifest: AccessManifestV2,
  state: ContainerAccessStateFields,
): void {
  if (
    manifest.objectKind !== "container" ||
    manifest.objectId !== state.containerId ||
    manifest.organizationId !== state.organizationId ||
    manifest.epoch !== state.epoch ||
    manifest.eventHash !== state.eventHash ||
    manifest.previousManifestHash !== state.previousManifestHash
  ) {
    throw new ContainerV2WriterProjectionError(
      "Container V2 manifest state mismatch",
      409,
    );
  }
}

function toManifestBundleResponse(input: {
  readonly event: VerifiedAccessEvent;
  readonly manifest: AccessManifestV2;
  readonly manifestHash: string;
  readonly state: KeyingV2CanonicalJson;
}): ContainerV2ManifestBundleResponse {
  return {
    event: verifiedAccessEventRecord(input.event),
    manifest: accessManifestRecord(input.manifest),
    manifestHash: input.manifestHash,
    state: readCanonicalRecord(input.state, "Container V2 manifest state"),
  };
}

function toVerifiedContainerManifest(
  bundle: ContainerV2ManifestBundleResponse,
): VerifiedContainerAccessManifest {
  const manifest = readAccessManifest(bundle.manifest, "Container V2 manifest");
  return {
    event: readVerifiedAccessEvent(
      bundle.event,
      "Container V2 access event bundle",
    ),
    manifest,
    manifestHash: bundle.manifestHash,
    state: readContainerAccessState(bundle),
  } as VerifiedContainerAccessManifest;
}

function readContainerAccessState(
  bundle: ContainerV2ManifestBundleResponse,
): ContainerAccessManifestStateV2 {
  const record = readPlainRecord(bundle.state, "Container V2 manifest state");
  const manifest = readAccessManifest(bundle.manifest, "Container V2 manifest");
  const state = readContainerAccessStateFields(record);
  assertContainerManifestMatchesState(manifest, state);

  return {
    version: 2,
    containerId: state.containerId,
    organizationId: state.organizationId,
    epoch: state.epoch,
    previousManifestHash: state.previousManifestHash,
    eventHash: state.eventHash,
    parentContainerId: state.parentContainerId,
    parentManifestHash: state.parentManifestHash,
    metadataDocumentId: state.metadataDocumentId,
    containerKeyEpochId: state.containerKeyEpochId,
    directGrants: state.directGrants,
    referencedPrincipalHeads: state.referencedPrincipalHeads,
  };
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

function containerKeyEpochRecord(
  keyEpoch: ContainerKeyEpochV2,
): Record<string, unknown> {
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

function containerKeyWrapRecord(
  wrap: ContainerKeyWrapV2,
): Record<string, unknown> {
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

function containerKekRecipientTargetRecord(
  target: ContainerKekRecipientTargetV2,
): Record<string, unknown> {
  return {
    recipientKind: target.recipientKind,
    recipientId: target.recipientId,
    recipientKeyEpochId: target.recipientKeyEpochId,
    recipientKeyFingerprint: target.recipientKeyFingerprint,
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
    event: bundle.event,
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
    keyEpoch: containerKeyEpochRecord(keyEpoch),
    keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
    keyTargetHash:
      await computeContainerKekRecipientTargetHash(recipientTargets),
    parentContainerKeyEpochId: keyEpoch.parentContainerKeyEpochId,
    recipientTargets: recipientTargets.map(containerKekRecipientTargetRecord),
    wraps: wraps.map(containerKeyWrapRecord),
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
