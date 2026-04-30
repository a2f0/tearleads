import type {
  AccessManifestV2,
  ContainerAccessLevelV2,
  ContainerAccessManifestStateV2,
  ContainerDirectGrantV2,
  ContainerGrantSubjectTypeV2,
  ContainerKekRecipientTargetV2,
  ContainerKeyEpochV2,
  ContainerKeyWrapV2,
  ContainerUserRecipientKeyV2,
  KeyingV2CanonicalJson,
  ReferencedPrincipalHeadV2,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  resolveContainerPathUserAccessLevel,
  verifyContainerKekState,
} from "@tearleads/crypto";
import type {
  ContainerV2KekResponse,
  ContainerV2ManifestBundleResponse,
  ContainerV2WriterProjectionResponse,
} from "@tearleads/validators/response";
import { eq, inArray } from "drizzle-orm";
import {
  getAccessManifestBundle,
  getCurrentAccessManifestHead,
} from "../../access/accessManifestStore";
import {
  getContainerKeyEpochById,
  listContainerKeyWraps,
} from "../../access/containerKekStore";
import type { DatabaseExecutor } from "../../adapters/postgres";
import { containers, users } from "../../schema";
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
const MAX_CONTAINER_PATH_DEPTH = 100;

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

export interface ContainerV2AccessProjection {
  readonly accessLevel: ContainerAccessLevelV2;
  readonly path: ContainerV2ManifestBundleResponse[];
  readonly principalPolicies: VerifiedPrincipalPolicy[];
  readonly verifiedPath: VerifiedContainerAccessManifest[];
}

export interface ContainerV2WriterProjectionContext {
  readonly containerKekStateByCacheKey: Map<
    string,
    Promise<VerifiedContainerKekState>
  >;
  readonly containerPathRowById: Map<string, Promise<ContainerPathRow>>;
  readonly executor: DatabaseExecutor;
  readonly currentManifestBundleByContainerId: Map<
    string,
    Promise<ContainerV2ManifestBundleResponse>
  >;
  readonly manifestBundleByHash: Map<
    string,
    Promise<ContainerV2ManifestBundleResponse>
  >;
}

export function createContainerV2WriterProjectionContext(
  executor: DatabaseExecutor,
): ContainerV2WriterProjectionContext {
  return {
    containerKekStateByCacheKey: new Map(),
    containerPathRowById: new Map(),
    executor,
    currentManifestBundleByContainerId: new Map(),
    manifestBundleByHash: new Map(),
  };
}

async function cachedProjectionValue<K, V>(
  cache: Map<K, Promise<V>>,
  key: K,
  load: () => Promise<V>,
): Promise<V> {
  const cachedValue = cache.get(key);
  if (cachedValue) {
    return cachedValue;
  }

  const loadedValue = load();
  cache.set(key, loadedValue);

  try {
    return await loadedValue;
  } catch (error) {
    if (cache.get(key) === loadedValue) {
      cache.delete(key);
    }
    throw error;
  }
}

function principalPolicyReferenceCacheKey(
  principalHead: ReferencedPrincipalHeadV2,
): string {
  return [
    principalHead.principalType,
    principalHead.principalId,
    principalHead.version,
    principalHead.keyEpoch,
    principalHead.stateHash,
    principalHead.keyFingerprint,
  ].join(":");
}

function principalPolicyMatchesReference(input: {
  readonly policy: VerifiedPrincipalPolicy;
  readonly reference: ReferencedPrincipalHeadV2;
}): boolean {
  return (
    input.policy.principalType === input.reference.principalType &&
    input.policy.principalId === input.reference.principalId &&
    input.policy.version === input.reference.version &&
    input.policy.keyEpoch === input.reference.keyEpoch &&
    input.policy.stateHash === input.reference.stateHash &&
    input.policy.state.keyFingerprint === input.reference.keyFingerprint
  );
}

function principalPolicyCacheKey(input: {
  readonly manifest: VerifiedContainerAccessManifest;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}): string {
  return input.manifest.state.referencedPrincipalHeads
    .map((principalHead) => {
      const referenceKey = principalPolicyReferenceCacheKey(principalHead);
      const matchingPolicy = input.principalPolicies.find((policy) =>
        principalPolicyMatchesReference({
          policy,
          reference: principalHead,
        }),
      );

      return matchingPolicy ? referenceKey : `missing:${referenceKey}`;
    })
    .sort()
    .join("|");
}

function containerKekStateCacheKey(input: {
  readonly manifest: VerifiedContainerAccessManifest;
  readonly parentKekState: VerifiedContainerKekState | null;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}): string {
  // KEK verification depends on the signed manifest, the parent KEK edge, and
  // the exact referenced principal policy heads. Include all three so a cache
  // hit cannot hide stale parent key material or a missing policy proof.
  const parentKey = input.parentKekState
    ? [
        input.parentKekState.containerId,
        input.parentKekState.accessManifestHash,
        input.parentKekState.containerKeyEpochId,
        input.parentKekState.keyEpochHash,
      ].join(":")
    : "root";

  return [
    input.manifest.manifestHash,
    parentKey,
    principalPolicyCacheKey({
      manifest: input.manifest,
      principalPolicies: input.principalPolicies,
    }),
  ].join("||");
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

function isAccessLevelAtLeast(
  accessLevel: ContainerAccessLevelV2 | null,
  minimumAccessLevel: ContainerAccessLevelV2,
): accessLevel is ContainerAccessLevelV2 {
  if (accessLevel === null) {
    return false;
  }

  if (accessLevel === "admin" || accessLevel === minimumAccessLevel) {
    return true;
  }

  return minimumAccessLevel === "read" && accessLevel === "write";
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
  context: ContainerV2WriterProjectionContext,
  containerId: string,
): Promise<ContainerPathRow[]> {
  const path: ContainerPathRow[] = [];
  const seenContainerIds = new Set<string>();
  let currentContainerId: string | null = containerId;

  while (currentContainerId !== null) {
    if (path.length >= MAX_CONTAINER_PATH_DEPTH) {
      throw new ContainerV2WriterProjectionError(
        "Container path exceeds maximum depth",
        409,
      );
    }
    if (seenContainerIds.has(currentContainerId)) {
      throw new ContainerV2WriterProjectionError(
        "Container path contains a cycle",
        409,
      );
    }
    seenContainerIds.add(currentContainerId);

    const row = await loadContainerPathRow(context, currentContainerId);
    path.push(row);
    currentContainerId = row.parentId;
  }

  return path.reverse();
}

async function loadContainerPathRow(
  context: ContainerV2WriterProjectionContext,
  containerId: string,
): Promise<ContainerPathRow> {
  return cachedProjectionValue(
    context.containerPathRowById,
    containerId,
    async () => {
      const [row] = await context.executor
        .select({
          id: containers.id,
          organizationId: containers.organizationId,
          parentId: containers.parentId,
        })
        .from(containers)
        .where(eq(containers.id, containerId))
        .limit(1);

      if (!row) {
        throw new ContainerV2WriterProjectionError("Container not found", 404);
      }

      return row;
    },
  );
}

async function loadCurrentContainerManifestBundle(
  context: ContainerV2WriterProjectionContext,
  containerId: string,
): Promise<ContainerV2ManifestBundleResponse> {
  // The cache is intentionally scoped to one projection transaction. That keeps
  // repeated shared ancestors consistent within the response without reusing
  // current-head or authorization material across requests.
  return cachedProjectionValue(
    context.currentManifestBundleByContainerId,
    containerId,
    async () => {
      const head = await getCurrentAccessManifestHead(
        "container",
        containerId,
        context.executor,
      );
      if (!head) {
        throw new ContainerV2WriterProjectionError(
          "Container V2 manifest head missing",
          409,
        );
      }

      return loadContainerManifestBundleByHash(context, head.manifestHash);
    },
  );
}

async function loadContainerManifestBundleByHash(
  context: ContainerV2WriterProjectionContext,
  manifestHash: string,
): Promise<ContainerV2ManifestBundleResponse> {
  return cachedProjectionValue(
    context.manifestBundleByHash,
    manifestHash,
    async () => {
      const bundle = await getAccessManifestBundle(
        manifestHash,
        context.executor,
      );
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
    },
  );
}

async function loadContainerKekManifestHistory(input: {
  readonly context: ContainerV2WriterProjectionContext;
  readonly currentManifest: VerifiedContainerAccessManifest;
  readonly keyEpoch: ContainerKeyEpochV2;
  readonly wraps: readonly ContainerKeyWrapV2[];
}): Promise<VerifiedContainerAccessManifest[]> {
  const historyHashes = new Set([
    input.keyEpoch.accessManifestHash,
    input.keyEpoch.createdByManifestHash,
    ...input.wraps.map((wrap) => wrap.wrapManifestHash),
  ]);
  historyHashes.delete(input.currentManifest.manifestHash);

  const history: VerifiedContainerAccessManifest[] = [];
  for (const manifestHash of [...historyHashes].sort()) {
    history.push(
      toVerifiedContainerManifest(
        await loadContainerManifestBundleByHash(input.context, manifestHash),
      ),
    );
  }

  return history;
}

function collectDirectUserGrantIds(
  manifest: VerifiedContainerAccessManifest,
): string[] {
  return [
    ...new Set(
      manifest.state.directGrants
        .filter((grant) => grant.subjectType === "user")
        .map((grant) => grant.subjectId),
    ),
  ].sort();
}

function userRecipientKeyFromWrap(
  wrap: ContainerKeyWrapV2,
): ContainerUserRecipientKeyV2 {
  return {
    userId: wrap.recipientId,
    recipientKeyEpochId: wrap.recipientKeyEpochId,
    recipientKeyFingerprint: wrap.recipientKeyFingerprint,
  };
}

async function loadUserRecipientKeysForContainerKek(input: {
  readonly executor: DatabaseExecutor;
  readonly manifest: VerifiedContainerAccessManifest;
  readonly wraps: readonly ContainerKeyWrapV2[];
}): Promise<ContainerUserRecipientKeyV2[]> {
  const userIds = collectDirectUserGrantIds(input.manifest);
  if (userIds.length === 0) {
    return [];
  }

  const userIdSet = new Set(userIds);
  const keyByUserId = new Map<string, ContainerUserRecipientKeyV2>();
  for (const wrap of input.wraps) {
    if (wrap.recipientKind !== "user" || !userIdSet.has(wrap.recipientId)) {
      continue;
    }

    if (keyByUserId.has(wrap.recipientId)) {
      throw new ContainerV2WriterProjectionError(
        "Container V2 KEK user recipient key is ambiguous",
        409,
      );
    }
    keyByUserId.set(wrap.recipientId, userRecipientKeyFromWrap(wrap));
  }

  const storedUsers = await input.executor
    .select({
      encapsulationKeyFingerprint: users.encapsulationKeyFingerprint,
      id: users.id,
    })
    .from(users)
    .where(inArray(users.id, userIds));
  const storedUserById = new Map(storedUsers.map((user) => [user.id, user]));
  const userRecipientKeys: ContainerUserRecipientKeyV2[] = [];

  for (const userId of userIds) {
    const userRecipientKey = keyByUserId.get(userId);
    const storedUser = storedUserById.get(userId);
    if (!userRecipientKey || !storedUser) {
      throw new ContainerV2WriterProjectionError(
        "Container V2 KEK user recipient key missing",
        409,
      );
    }
    if (
      userRecipientKey.recipientKeyFingerprint !==
      storedUser.encapsulationKeyFingerprint
    ) {
      throw new ContainerV2WriterProjectionError(
        "Container V2 KEK user recipient key is stale",
        409,
      );
    }
    userRecipientKeys.push(userRecipientKey);
  }

  return userRecipientKeys;
}

async function loadContainerKekState(
  context: ContainerV2WriterProjectionContext,
  manifest: VerifiedContainerAccessManifest,
  input: {
    readonly parentKekState: VerifiedContainerKekState | null;
    readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
  },
): Promise<VerifiedContainerKekState> {
  return cachedProjectionValue(
    context.containerKekStateByCacheKey,
    containerKekStateCacheKey({
      manifest,
      parentKekState: input.parentKekState,
      principalPolicies: input.principalPolicies,
    }),
    async () =>
      loadUncachedContainerKekState(context, manifest, {
        parentKekState: input.parentKekState,
        principalPolicies: input.principalPolicies,
      }),
  );
}

async function loadUncachedContainerKekState(
  context: ContainerV2WriterProjectionContext,
  manifest: VerifiedContainerAccessManifest,
  input: {
    readonly parentKekState: VerifiedContainerKekState | null;
    readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
  },
): Promise<VerifiedContainerKekState> {
  const containerKeyEpochId = manifest.state.containerKeyEpochId;
  if (!containerKeyEpochId) {
    throw new ContainerV2WriterProjectionError(
      "Container V2 KEK state missing",
      409,
    );
  }

  const storedKeyEpoch = await getContainerKeyEpochById(
    containerKeyEpochId,
    context.executor,
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
    await listContainerKeyWraps(containerKeyEpochId, context.executor)
  ).map(stripContainerKeyWrap);
  const containerManifestHistory = await loadContainerKekManifestHistory({
    context,
    currentManifest: manifest,
    keyEpoch,
    wraps,
  });
  const userRecipientKeys = await loadUserRecipientKeysForContainerKek({
    executor: context.executor,
    manifest,
    wraps,
  });
  const verified = await verifyContainerKekState({
    containerManifest: manifest,
    containerManifestHistory,
    keyEpoch,
    parentKekState: input.parentKekState,
    principalPolicies: input.principalPolicies,
    userRecipientKeys,
    wraps,
  });

  if (!verified.ok) {
    throw new ContainerV2WriterProjectionError(verified.error.message, 409);
  }

  return verified.value;
}

function containerKekResponse(
  kekState: VerifiedContainerKekState,
): ContainerV2KekResponse {
  return {
    containerId: kekState.containerId,
    accessManifestHash: kekState.accessManifestHash,
    containerKeyEpochId: kekState.containerKeyEpochId,
    containerKeyEpoch: kekState.containerKeyEpoch,
    keyEpoch: containerKeyEpochRecord(kekState.keyEpoch),
    keyEpochHash: kekState.keyEpochHash,
    keyTargetHash: kekState.keyTargetHash,
    parentContainerKeyEpochId: kekState.parentContainerKeyEpochId,
    recipientTargets: kekState.recipientTargets.map(
      containerKekRecipientTargetRecord,
    ),
    wraps: kekState.wraps.map(containerKeyWrapRecord),
  };
}

export async function resolveContainerV2WriterProjection(input: {
  readonly context?: ContainerV2WriterProjectionContext;
  readonly containerId: string;
  readonly executor: DatabaseExecutor;
  readonly userId: string;
}): Promise<ContainerV2WriterProjectionResponse> {
  const context =
    input.context ?? createContainerV2WriterProjectionContext(input.executor);
  const access = await resolveContainerV2AccessProjection({
    ...input,
    context,
    minimumAccessLevel: "write",
  });

  const containerKekStates: VerifiedContainerKekState[] = [];
  for (const manifest of access.verifiedPath) {
    containerKekStates.push(
      await loadContainerKekState(context, manifest, {
        parentKekState: containerKekStates.at(-1) ?? null,
        principalPolicies: access.principalPolicies,
      }),
    );
  }
  const targetManifest = access.verifiedPath.at(-1);
  if (!targetManifest) {
    throw new ContainerV2WriterProjectionError("Container not found", 404);
  }

  return {
    containerId: input.containerId,
    organizationId: targetManifest.state.organizationId,
    path: access.path,
    containerKeks: containerKekStates.map(containerKekResponse),
  };
}

export async function resolveContainerV2AccessProjection(input: {
  readonly context?: ContainerV2WriterProjectionContext;
  readonly containerId: string;
  readonly executor: DatabaseExecutor;
  readonly minimumAccessLevel: ContainerAccessLevelV2;
  readonly userId: string;
}): Promise<ContainerV2AccessProjection> {
  const context =
    input.context ?? createContainerV2WriterProjectionContext(input.executor);
  const pathRows = await loadContainerPath(context, input.containerId);
  const path = await Promise.all(
    pathRows.map((row) => loadCurrentContainerManifestBundle(context, row.id)),
  );
  const verifiedPath = path.map(toVerifiedContainerManifest);
  let principalPolicies: VerifiedPrincipalPolicy[];
  try {
    principalPolicies = await loadPrincipalPoliciesForContainerPaths(
      context.executor,
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

  if (!isAccessLevelAtLeast(accessLevel, input.minimumAccessLevel)) {
    throw new ContainerV2WriterProjectionError("Forbidden", 403);
  }

  return {
    accessLevel,
    path,
    principalPolicies,
    verifiedPath,
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
      context: createContainerV2WriterProjectionContext(tx),
      executor: tx,
      userId: input.userId,
    }),
  );
}
