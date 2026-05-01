import type {
  AccessManifest,
  ContainerAccessLevel,
  ContainerAccessManifestState,
  ContainerDirectGrant,
  ContainerGrantSubjectType,
  ContainerKekRecipientTarget,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  KeyingCanonicalJson,
  ReferencedPrincipalHead,
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
  ContainerKekResponse,
  ContainerManifestBundleResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { eq, inArray } from "drizzle-orm";
import {
  getAccessManifestBundle,
  getCurrentAccessManifestHead,
} from "../../access/read/accessManifestStore";
import {
  getContainerKeyEpochById,
  listContainerKeyWraps,
} from "../../access/read/containerKekStore";
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
  readProjectionVersion,
} from "../keyingProjectionRecords";
import type { ApiServiceRuntime } from "../runtime";

type ContainerWriterProjectionStatus = 403 | 404 | 409;
const MAX_CONTAINER_PATH_DEPTH = 100;

export class ContainerWriterProjectionError extends Error {
  constructor(
    message: string,
    readonly status: ContainerWriterProjectionStatus,
  ) {
    super(message);
    this.name = "ContainerWriterProjectionError";
  }
}

interface ContainerPathRow {
  readonly id: string;
  readonly organizationId: string;
  readonly parentId: string | null;
}

export interface ContainerAccessProjection {
  readonly accessLevel: ContainerAccessLevel;
  readonly path: ContainerManifestBundleResponse[];
  readonly principalPolicies: VerifiedPrincipalPolicy[];
  readonly verifiedPath: VerifiedContainerAccessManifest[];
}

export interface ContainerWriterProjectionContext {
  readonly containerKekStateByCacheKey: Map<
    string,
    Promise<ContainerKekProjection>
  >;
  readonly containerPathRowById: Map<string, Promise<ContainerPathRow>>;
  readonly executor: DatabaseExecutor;
  readonly currentManifestBundleByContainerId: Map<
    string,
    Promise<ContainerManifestBundleResponse>
  >;
  readonly manifestBundleByHash: Map<
    string,
    Promise<ContainerManifestBundleResponse>
  >;
}

interface ContainerKekManifestHistory {
  readonly bundles: ContainerManifestBundleResponse[];
  readonly verified: VerifiedContainerAccessManifest[];
}

interface ContainerKekProjection {
  readonly manifestHistory: ContainerManifestBundleResponse[];
  readonly state: VerifiedContainerKekState;
}

export function createContainerWriterProjectionContext(
  executor: DatabaseExecutor,
): ContainerWriterProjectionContext {
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
  principalHead: ReferencedPrincipalHead,
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
  readonly reference: ReferencedPrincipalHead;
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

function projectionError(message: string): ContainerWriterProjectionError {
  return new ContainerWriterProjectionError(message, 409);
}

function readPlainRecord(value: unknown, label: string) {
  return readProjectionPlainRecord(value, label, projectionError);
}

function readCanonicalRecord(value: KeyingCanonicalJson, label: string) {
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

function readVersion(record: Record<string, unknown>, label: string) {
  return readProjectionVersion(record, label, projectionError);
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

function isContainerAccessLevel(value: unknown): value is ContainerAccessLevel {
  return value === "admin" || value === "read" || value === "write";
}

function isContainerGrantSubjectType(
  value: unknown,
): value is ContainerGrantSubjectType {
  return value === "group" || value === "organization" || value === "user";
}

function isAccessLevelAtLeast(
  accessLevel: ContainerAccessLevel | null,
  minimumAccessLevel: ContainerAccessLevel,
): accessLevel is ContainerAccessLevel {
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
): ContainerDirectGrant {
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
): ContainerDirectGrant[] {
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
  readonly directGrants: ContainerDirectGrant[];
  readonly epoch: number;
  readonly eventHash: string;
  readonly metadataDocumentId: string;
  readonly organizationId: string;
  readonly parentContainerId: string | null;
  readonly parentManifestHash: string | null;
  readonly previousManifestHash: string | null;
  readonly referencedPrincipalHeads: ReferencedPrincipalHead[];
}

function readContainerAccessStateFields(
  record: Record<string, unknown>,
): ContainerAccessStateFields {
  readVersion(record, "Container manifest state");

  return {
    containerId: readString(record, "containerId", "Container manifest state"),
    organizationId: readString(
      record,
      "organizationId",
      "Container manifest state",
    ),
    epoch: readPositiveInteger(record, "epoch", "Container manifest state"),
    previousManifestHash: readNullableString(
      record,
      "previousManifestHash",
      "Container manifest state",
    ),
    eventHash: readString(record, "eventHash", "Container manifest state"),
    parentContainerId: readNullableString(
      record,
      "parentContainerId",
      "Container manifest state",
    ),
    parentManifestHash: readNullableString(
      record,
      "parentManifestHash",
      "Container manifest state",
    ),
    metadataDocumentId: readString(
      record,
      "metadataDocumentId",
      "Container manifest state",
    ),
    containerKeyEpochId: readString(
      record,
      "containerKeyEpochId",
      "Container manifest state",
    ),
    directGrants: readContainerDirectGrants(
      readValue(record, "directGrants"),
      "Container manifest state.directGrants",
    ),
    referencedPrincipalHeads: readReferencedPrincipalHeads(
      readValue(record, "referencedPrincipalHeads"),
      "Container manifest state.referencedPrincipalHeads",
    ),
  };
}

function assertContainerManifestMatchesState(
  manifest: AccessManifest,
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
    throw new ContainerWriterProjectionError(
      "Container manifest state mismatch",
      409,
    );
  }
}

function toManifestBundleResponse(input: {
  readonly event: VerifiedAccessEvent;
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
  readonly state: KeyingCanonicalJson;
}): ContainerManifestBundleResponse {
  return {
    event: verifiedAccessEventRecord(input.event),
    manifest: accessManifestRecord(input.manifest),
    manifestHash: input.manifestHash,
    state: readCanonicalRecord(input.state, "Container manifest state"),
  };
}

function toVerifiedContainerManifest(
  bundle: ContainerManifestBundleResponse,
): VerifiedContainerAccessManifest {
  const manifest = readAccessManifest(bundle.manifest, "Container manifest");
  return {
    event: readVerifiedAccessEvent(
      bundle.event,
      "Container access event bundle",
    ),
    manifest,
    manifestHash: bundle.manifestHash,
    state: readContainerAccessState(bundle),
  } as VerifiedContainerAccessManifest;
}

function readContainerAccessState(
  bundle: ContainerManifestBundleResponse,
): ContainerAccessManifestState {
  const record = readPlainRecord(bundle.state, "Container manifest state");
  const manifest = readAccessManifest(bundle.manifest, "Container manifest");
  const state = readContainerAccessStateFields(record);
  assertContainerManifestMatchesState(manifest, state);

  return {
    version: 1,
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
  keyEpoch: ContainerKeyEpoch,
): ContainerKeyEpoch {
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
  keyEpoch: ContainerKeyEpoch,
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

function stripContainerKeyWrap(wrap: ContainerKeyWrap): ContainerKeyWrap {
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
  wrap: ContainerKeyWrap,
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
  target: ContainerKekRecipientTarget,
): Record<string, unknown> {
  return {
    recipientKind: target.recipientKind,
    recipientId: target.recipientId,
    recipientKeyEpochId: target.recipientKeyEpochId,
    recipientKeyFingerprint: target.recipientKeyFingerprint,
  };
}

async function loadContainerPath(
  context: ContainerWriterProjectionContext,
  containerId: string,
): Promise<ContainerPathRow[]> {
  const path: ContainerPathRow[] = [];
  const seenContainerIds = new Set<string>();
  let currentContainerId: string | null = containerId;

  while (currentContainerId !== null) {
    if (path.length >= MAX_CONTAINER_PATH_DEPTH) {
      throw new ContainerWriterProjectionError(
        "Container path exceeds maximum depth",
        409,
      );
    }
    if (seenContainerIds.has(currentContainerId)) {
      throw new ContainerWriterProjectionError(
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
  context: ContainerWriterProjectionContext,
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
        throw new ContainerWriterProjectionError("Container not found", 404);
      }

      return row;
    },
  );
}

async function loadCurrentContainerManifestBundle(
  context: ContainerWriterProjectionContext,
  containerId: string,
): Promise<ContainerManifestBundleResponse> {
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
        throw new ContainerWriterProjectionError(
          "Container manifest head missing",
          409,
        );
      }

      return loadContainerManifestBundleByHash(context, head.manifestHash);
    },
  );
}

async function loadContainerManifestBundleByHash(
  context: ContainerWriterProjectionContext,
  manifestHash: string,
): Promise<ContainerManifestBundleResponse> {
  return cachedProjectionValue(
    context.manifestBundleByHash,
    manifestHash,
    async () => {
      const bundle = await getAccessManifestBundle(
        manifestHash,
        context.executor,
      );
      if (!bundle || bundle.manifest.objectKind !== "container") {
        throw new ContainerWriterProjectionError(
          "Container manifest bundle missing",
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
  readonly context: ContainerWriterProjectionContext;
  readonly currentManifest: VerifiedContainerAccessManifest;
  readonly keyEpoch: ContainerKeyEpoch;
  readonly wraps: readonly ContainerKeyWrap[];
}): Promise<ContainerKekManifestHistory> {
  const pendingHashes = new Set<string>();
  const visitedHashes = new Set([input.currentManifest.manifestHash]);
  const enqueue = (manifestHash: string | null): void => {
    if (!manifestHash || visitedHashes.has(manifestHash)) {
      return;
    }
    pendingHashes.add(manifestHash);
  };

  enqueue(input.currentManifest.manifest.previousManifestHash);
  enqueue(input.keyEpoch.accessManifestHash);
  enqueue(input.keyEpoch.createdByManifestHash);
  for (const wrap of input.wraps) {
    enqueue(wrap.wrapManifestHash);
  }

  const bundles: ContainerManifestBundleResponse[] = [];
  const verified: VerifiedContainerAccessManifest[] = [];
  while (pendingHashes.size > 0) {
    const next = pendingHashes.values().next();
    if (next.done) {
      break;
    }
    const manifestHash = next.value;
    pendingHashes.delete(manifestHash);
    visitedHashes.add(manifestHash);

    const bundle = await loadContainerManifestBundleByHash(
      input.context,
      manifestHash,
    );
    const verifiedManifest = toVerifiedContainerManifest(bundle);
    bundles.push(bundle);
    verified.push(verifiedManifest);
    enqueue(verifiedManifest.manifest.previousManifestHash);
  }

  return { bundles, verified };
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
  wrap: ContainerKeyWrap,
): ContainerUserRecipientKey {
  return {
    userId: wrap.recipientId,
    recipientKeyEpochId: wrap.recipientKeyEpochId,
    recipientKeyFingerprint: wrap.recipientKeyFingerprint,
  };
}

async function loadUserRecipientKeysForContainerKek(input: {
  readonly executor: DatabaseExecutor;
  readonly manifest: VerifiedContainerAccessManifest;
  readonly wraps: readonly ContainerKeyWrap[];
}): Promise<ContainerUserRecipientKey[]> {
  const userIds = collectDirectUserGrantIds(input.manifest);
  if (userIds.length === 0) {
    return [];
  }

  const userIdSet = new Set(userIds);
  const keyByUserId = new Map<string, ContainerUserRecipientKey>();
  for (const wrap of input.wraps) {
    if (wrap.recipientKind !== "user" || !userIdSet.has(wrap.recipientId)) {
      continue;
    }

    if (keyByUserId.has(wrap.recipientId)) {
      throw new ContainerWriterProjectionError(
        "Container KEK user recipient key is ambiguous",
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
  const userRecipientKeys: ContainerUserRecipientKey[] = [];

  for (const userId of userIds) {
    const userRecipientKey = keyByUserId.get(userId);
    const storedUser = storedUserById.get(userId);
    if (!userRecipientKey || !storedUser) {
      throw new ContainerWriterProjectionError(
        "Container KEK user recipient key missing",
        409,
      );
    }
    if (
      userRecipientKey.recipientKeyFingerprint !==
      storedUser.encapsulationKeyFingerprint
    ) {
      throw new ContainerWriterProjectionError(
        "Container KEK user recipient key is stale",
        409,
      );
    }
    userRecipientKeys.push(userRecipientKey);
  }

  return userRecipientKeys;
}

async function loadContainerKekState(
  context: ContainerWriterProjectionContext,
  manifest: VerifiedContainerAccessManifest,
  input: {
    readonly parentKekState: VerifiedContainerKekState | null;
    readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
  },
): Promise<ContainerKekProjection> {
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
  context: ContainerWriterProjectionContext,
  manifest: VerifiedContainerAccessManifest,
  input: {
    readonly parentKekState: VerifiedContainerKekState | null;
    readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
  },
): Promise<ContainerKekProjection> {
  const containerKeyEpochId = manifest.state.containerKeyEpochId;
  if (!containerKeyEpochId) {
    throw new ContainerWriterProjectionError(
      "Container KEK state missing",
      409,
    );
  }

  const storedKeyEpoch = await getContainerKeyEpochById(
    containerKeyEpochId,
    context.executor,
  );
  if (!storedKeyEpoch) {
    throw new ContainerWriterProjectionError(
      "Container KEK epoch missing",
      409,
    );
  }
  if (storedKeyEpoch.containerId !== manifest.state.containerId) {
    throw new ContainerWriterProjectionError(
      "Container KEK epoch is stale",
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
    containerManifestHistory: containerManifestHistory.verified,
    keyEpoch,
    parentKekState: input.parentKekState,
    principalPolicies: input.principalPolicies,
    userRecipientKeys,
    wraps,
  });

  if (!verified.ok) {
    throw new ContainerWriterProjectionError(verified.error.message, 409);
  }

  return {
    manifestHistory: containerManifestHistory.bundles,
    state: verified.value,
  };
}

function containerKekResponse(
  projection: ContainerKekProjection,
): ContainerKekResponse {
  const kekState = projection.state;
  return {
    containerId: kekState.containerId,
    accessManifestHash: kekState.accessManifestHash,
    containerKeyEpochId: kekState.containerKeyEpochId,
    containerKeyEpoch: kekState.containerKeyEpoch,
    keyEpoch: containerKeyEpochRecord(kekState.keyEpoch),
    keyEpochHash: kekState.keyEpochHash,
    keyTargetHash: kekState.keyTargetHash,
    parentContainerKeyEpochId: kekState.parentContainerKeyEpochId,
    containerManifestHistory: projection.manifestHistory,
    recipientTargets: kekState.recipientTargets.map(
      containerKekRecipientTargetRecord,
    ),
    wraps: kekState.wraps.map(containerKeyWrapRecord),
  };
}

export async function resolveContainerWriterProjection(input: {
  readonly context?: ContainerWriterProjectionContext;
  readonly containerId: string;
  readonly executor: DatabaseExecutor;
  readonly userId: string;
}): Promise<ContainerWriterProjectionResponse> {
  const context =
    input.context ?? createContainerWriterProjectionContext(input.executor);
  const access = await resolveContainerAccessProjection({
    ...input,
    context,
    minimumAccessLevel: "write",
  });

  const containerKekStates: ContainerKekProjection[] = [];
  for (const manifest of access.verifiedPath) {
    containerKekStates.push(
      await loadContainerKekState(context, manifest, {
        parentKekState: containerKekStates.at(-1)?.state ?? null,
        principalPolicies: access.principalPolicies,
      }),
    );
  }
  const targetManifest = access.verifiedPath.at(-1);
  if (!targetManifest) {
    throw new ContainerWriterProjectionError("Container not found", 404);
  }

  return {
    containerId: input.containerId,
    organizationId: targetManifest.state.organizationId,
    path: access.path,
    containerKeks: containerKekStates.map(containerKekResponse),
  };
}

export async function resolveContainerAccessProjection(input: {
  readonly context?: ContainerWriterProjectionContext;
  readonly containerId: string;
  readonly executor: DatabaseExecutor;
  readonly minimumAccessLevel: ContainerAccessLevel;
  readonly userId: string;
}): Promise<ContainerAccessProjection> {
  const context =
    input.context ?? createContainerWriterProjectionContext(input.executor);
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
      throw new ContainerWriterProjectionError(error.message, error.status);
    }
    throw error;
  }
  const accessLevel = resolveContainerPathUserAccessLevel({
    path: verifiedPath,
    principalPolicies,
    userId: input.userId,
  });

  if (!isAccessLevelAtLeast(accessLevel, input.minimumAccessLevel)) {
    throw new ContainerWriterProjectionError("Forbidden", 403);
  }

  return {
    accessLevel,
    path,
    principalPolicies,
    verifiedPath,
  };
}

export async function getContainerWriterProjection(
  runtime: ApiServiceRuntime,
  input: {
    readonly containerId: string;
    readonly userId: string;
  },
): Promise<ContainerWriterProjectionResponse> {
  return runtime.db.transaction((tx) =>
    resolveContainerWriterProjection({
      containerId: input.containerId,
      context: createContainerWriterProjectionContext(tx),
      executor: tx,
      userId: input.userId,
    }),
  );
}
