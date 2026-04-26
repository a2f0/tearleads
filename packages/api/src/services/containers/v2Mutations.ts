import type {
  AccessEventTypeV2,
  AccessEventV2,
  AccessManifestV2,
  ContainerKeyEpochV2,
  ContainerKeyWrapV2,
  ContainerUserRecipientKeyV2,
  KeyingV2CanonicalJson,
  PrincipalProjectionMember,
  VerifiedAccessManifest,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  computeContainerKeyEpochHash,
  deriveContainerAccessManifest,
  KeyingV2VerificationError,
  serializeKeyingV2CanonicalJson,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type {
  ContainerV2ManifestBundle,
  ContainerV2MutationRequest,
} from "@tearleads/validators/request";
import type { ContainerV2MutationResponse } from "@tearleads/validators/response";
import { eq, inArray } from "drizzle-orm";
import {
  getCurrentAccessManifestHead,
  storeVerifiedAccessManifest,
} from "../../access/accessManifestStore";
import {
  getCurrentContainerKeyEpoch,
  storeVerifiedContainerKekState,
} from "../../access/containerKekStore";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "../../access/principalStateStore";
import type { DatabaseExecutor } from "../../adapters/postgres";
import { containers, users } from "../../schema";
import type { ApiServiceRuntime } from "../runtime";

type ContainerV2MutationStatus = 400 | 403 | 404 | 409;

export class ContainerV2MutationError extends Error {
  constructor(
    message: string,
    readonly status: ContainerV2MutationStatus,
  ) {
    super(message);
    this.name = "ContainerV2MutationError";
  }
}

interface MutateContainerV2Input {
  readonly expectedContainerId?: string;
  readonly expectedEventType: AccessEventTypeV2;
  readonly fingerprint: string;
  readonly request: ContainerV2MutationRequest;
  readonly userId: string;
}

interface StoredContainerRow {
  readonly id: string;
  readonly organizationId: string;
  readonly parentId: string | null;
}

function toVerifiedContainerManifest(
  bundle: ContainerV2ManifestBundle,
): VerifiedContainerAccessManifest {
  return bundle as unknown as VerifiedContainerAccessManifest;
}

function toVerifiedContainerManifestArray(
  bundles: readonly ContainerV2ManifestBundle[] | undefined,
): VerifiedContainerAccessManifest[] | undefined {
  return bundles?.map(toVerifiedContainerManifest);
}

function principalPoliciesFromRequest(
  request: ContainerV2MutationRequest,
): VerifiedPrincipalPolicy[] {
  return (request.principalPolicies ??
    []) as unknown as VerifiedPrincipalPolicy[];
}

function userRecipientKeysFromRequest(
  request: ContainerV2MutationRequest,
): ContainerUserRecipientKeyV2[] {
  return (request.userRecipientKeys ??
    []) as unknown as ContainerUserRecipientKeyV2[];
}

function canonicalJsonEquals(left: unknown, right: unknown): boolean {
  return (
    serializeKeyingV2CanonicalJson(left as KeyingV2CanonicalJson) ===
    serializeKeyingV2CanonicalJson(right as KeyingV2CanonicalJson)
  );
}

function projectionMemberKey(
  member: Pick<
    PrincipalProjectionMember,
    "memberPrincipalId" | "memberPrincipalType" | "role"
  >,
): string {
  return [
    member.memberPrincipalType,
    member.memberPrincipalId,
    member.role,
  ].join(":");
}

function toContainerKeyEpoch(
  keyEpoch: ContainerKeyEpochV2 & { readonly createdAt?: Date },
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

function mapVerificationStatus(
  error: KeyingV2VerificationError,
): ContainerV2MutationStatus {
  if (
    error.code === "signature_mismatch" ||
    error.code === "signer_mismatch" ||
    error.code === "unauthorized"
  ) {
    return 403;
  }

  if (error.code === "invalid_domain" || error.code === "invalid_shape") {
    return 400;
  }

  if (
    error.code === "object_mismatch" &&
    error.message.includes("descendant")
  ) {
    return 400;
  }

  return 409;
}

function toMutationError(error: unknown): ContainerV2MutationError | null {
  if (error instanceof ContainerV2MutationError) {
    return error;
  }

  if (error instanceof KeyingV2VerificationError) {
    return new ContainerV2MutationError(
      error.message,
      mapVerificationStatus(error),
    );
  }

  if (!(error instanceof Error)) {
    return null;
  }

  if (
    error.message.includes("conflict") ||
    error.message.includes("epoch") ||
    error.message.includes("stale")
  ) {
    return new ContainerV2MutationError(error.message, 409);
  }

  return null;
}

async function loadSignerPublicKey(
  executor: DatabaseExecutor,
  input: {
    readonly fingerprint: string;
    readonly userId: string;
  },
): Promise<Uint8Array> {
  const [user] = await executor
    .select({
      fingerprint: users.fingerprint,
      signingPublicKey: users.signingPublicKey,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!user || user.fingerprint !== input.fingerprint) {
    throw new ContainerV2MutationError("Forbidden", 403);
  }

  return base64ToBytes(user.signingPublicKey);
}

async function verifyMutationEvent(
  executor: DatabaseExecutor,
  input: MutateContainerV2Input,
) {
  const event = input.request.event as unknown as AccessEventV2;

  if (
    event.signerUserId !== input.userId ||
    event.signerKeyFingerprint !== input.fingerprint
  ) {
    throw new ContainerV2MutationError("Forbidden", 403);
  }

  if (event.eventType !== input.expectedEventType) {
    throw new ContainerV2MutationError("Unexpected container event type", 400);
  }

  if (
    input.expectedContainerId !== undefined &&
    event.objectId !== input.expectedContainerId
  ) {
    throw new ContainerV2MutationError("Container id mismatch", 400);
  }

  const verifiedEvent = await verifySignedAccessEvent({
    body: input.request.body as KeyingV2CanonicalJson,
    event,
    signerPublicKey: await loadSignerPublicKey(executor, input),
  });

  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }

  return verifiedEvent.value;
}

async function assertContainerManifestBundleConsistent(
  bundle: ContainerV2ManifestBundle,
  label: string,
): Promise<VerifiedContainerAccessManifest> {
  const verified = toVerifiedContainerManifest(bundle);
  const derivedManifest = await deriveContainerAccessManifest(verified.state);
  const derivedManifestHash = await computeAccessManifestHash(derivedManifest);
  const suppliedManifestHash = await computeAccessManifestHash(
    verified.manifest,
  );

  if (
    verified.manifestHash !== derivedManifestHash ||
    verified.manifestHash !== suppliedManifestHash ||
    !canonicalJsonEquals(derivedManifest, verified.manifest)
  ) {
    throw new ContainerV2MutationError(
      `${label} manifest bundle is not self-consistent`,
      409,
    );
  }

  if (
    verified.manifest.objectKind !== "container" ||
    verified.manifest.objectId !== verified.state.containerId ||
    verified.manifest.organizationId !== verified.state.organizationId ||
    verified.manifest.epoch !== verified.state.epoch ||
    verified.manifest.previousManifestHash !==
      verified.state.previousManifestHash ||
    verified.manifest.eventHash !== verified.state.eventHash ||
    verified.event.eventHash !== verified.state.eventHash ||
    verified.event.event.objectId !== verified.state.containerId ||
    verified.event.event.organizationId !== verified.state.organizationId
  ) {
    throw new ContainerV2MutationError(
      `${label} manifest bundle has inconsistent domains`,
      409,
    );
  }

  return verified;
}

async function assertManifestHeadCurrent(
  executor: DatabaseExecutor,
  manifest: VerifiedContainerAccessManifest,
  label: string,
): Promise<void> {
  const head = await getCurrentAccessManifestHead(
    "container",
    manifest.state.containerId,
    executor,
  );

  if (!head) {
    throw new ContainerV2MutationError(`${label} manifest head missing`, 404);
  }

  if (head.manifestHash !== manifest.manifestHash) {
    throw new ContainerV2MutationError(`${label} manifest head is stale`, 409);
  }
}

function assertContainerPathEdges(
  path: readonly VerifiedContainerAccessManifest[],
  label: string,
): void {
  for (let index = 1; index < path.length; index += 1) {
    const parent = path[index - 1];
    const child = path[index];

    if (!parent || !child) {
      continue;
    }

    if (
      child.state.parentContainerId !== parent.state.containerId ||
      child.state.parentManifestHash !== parent.manifestHash
    ) {
      throw new ContainerV2MutationError(
        `${label} does not match container parent edges`,
        409,
      );
    }
  }
}

async function assertCurrentContainerPath(
  executor: DatabaseExecutor,
  bundles: readonly ContainerV2ManifestBundle[] | undefined,
  label: string,
): Promise<void> {
  if (bundles === undefined) {
    return;
  }

  const path: VerifiedContainerAccessManifest[] = [];
  for (const [index, bundle] of bundles.entries()) {
    const manifest = await assertContainerManifestBundleConsistent(
      bundle,
      `${label}[${index}]`,
    );
    await assertManifestHeadCurrent(executor, manifest, `${label}[${index}]`);
    path.push(manifest);
  }

  assertContainerPathEdges(path, label);
}

async function assertHistoricalContainerManifestsConsistent(
  bundles: readonly ContainerV2ManifestBundle[] | undefined,
): Promise<void> {
  if (bundles === undefined) {
    return;
  }

  for (const [index, bundle] of bundles.entries()) {
    await assertContainerManifestBundleConsistent(
      bundle,
      `containerManifestHistory[${index}]`,
    );
  }
}

async function assertMutationHeadCanAdvance(
  executor: DatabaseExecutor,
  manifest: VerifiedContainerAccessManifest,
): Promise<void> {
  const currentHead = await getCurrentAccessManifestHead(
    "container",
    manifest.state.containerId,
    executor,
  );

  if (manifest.event.event.eventType === "container.create") {
    if (currentHead) {
      throw new ContainerV2MutationError(
        "Container manifest already exists",
        409,
      );
    }
    return;
  }

  if (!currentHead) {
    throw new ContainerV2MutationError("Container manifest head missing", 404);
  }

  if (currentHead.manifestHash !== manifest.state.previousManifestHash) {
    throw new ContainerV2MutationError("Container manifest head is stale", 409);
  }
}

async function assertUserRecipientKeysCurrent(
  executor: DatabaseExecutor,
  userRecipientKeys: readonly ContainerUserRecipientKeyV2[],
): Promise<void> {
  if (userRecipientKeys.length === 0) {
    return;
  }

  for (const key of userRecipientKeys) {
    if (
      typeof key.userId !== "string" ||
      typeof key.recipientKeyEpochId !== "string" ||
      typeof key.recipientKeyFingerprint !== "string"
    ) {
      throw new ContainerV2MutationError("Invalid user recipient key", 400);
    }
  }

  const userIds = [...new Set(userRecipientKeys.map((key) => key.userId))];
  const storedUsers = await executor
    .select({
      encapsulationKeyFingerprint: users.encapsulationKeyFingerprint,
      id: users.id,
    })
    .from(users)
    .where(inArray(users.id, userIds));
  const storedUserById = new Map(storedUsers.map((user) => [user.id, user]));

  for (const key of userRecipientKeys) {
    const storedUser = storedUserById.get(key.userId);
    if (!storedUser) {
      throw new ContainerV2MutationError("Recipient user not found", 409);
    }

    if (
      storedUser.encapsulationKeyFingerprint !== key.recipientKeyFingerprint
    ) {
      throw new ContainerV2MutationError(
        "Recipient user key fingerprint is stale",
        409,
      );
    }
  }
}

async function assertPrincipalPoliciesCurrent(
  executor: DatabaseExecutor,
  principalPolicies: readonly VerifiedPrincipalPolicy[],
): Promise<void> {
  for (const policy of principalPolicies) {
    if (
      typeof policy.principalType !== "string" ||
      typeof policy.principalId !== "string" ||
      typeof policy.version !== "number" ||
      typeof policy.keyEpoch !== "number" ||
      typeof policy.stateHash !== "string" ||
      typeof policy.state?.keyFingerprint !== "string" ||
      !Array.isArray(policy.projection)
    ) {
      throw new ContainerV2MutationError("Invalid principal policy", 400);
    }

    const currentState = await getCurrentPrincipalState(
      policy.principalType,
      policy.principalId,
      executor,
    );
    if (
      !currentState ||
      currentState.version !== policy.version ||
      currentState.keyEpoch !== policy.keyEpoch ||
      currentState.stateHash !== policy.stateHash ||
      currentState.keyFingerprint !== policy.state.keyFingerprint
    ) {
      throw new ContainerV2MutationError("Principal policy is stale", 409);
    }

    const storedProjection = await listCurrentPrincipalProjectionMembers(
      policy.principalType,
      policy.principalId,
      executor,
    );
    const storedProjectionKeys = storedProjection
      .map(projectionMemberKey)
      .sort();
    const policyProjectionKeys = policy.projection
      .map(projectionMemberKey)
      .sort();

    if (
      storedProjectionKeys.length !== policyProjectionKeys.length ||
      storedProjectionKeys.some(
        (storedKey, index) => storedKey !== policyProjectionKeys[index],
      )
    ) {
      throw new ContainerV2MutationError(
        "Principal policy projection is stale",
        409,
      );
    }
  }
}

async function assertParentKekStateCurrent(
  executor: DatabaseExecutor,
  manifest: VerifiedContainerAccessManifest,
  parentKekState: VerifiedContainerKekState | null,
): Promise<void> {
  if (!manifest.state.parentContainerId) {
    return;
  }

  if (!parentKekState) {
    throw new ContainerV2MutationError("Parent KEK state is required", 409);
  }

  if (parentKekState.containerId !== manifest.state.parentContainerId) {
    throw new ContainerV2MutationError(
      "Parent KEK state container mismatch",
      409,
    );
  }

  const currentParentEpoch = await getCurrentContainerKeyEpoch(
    parentKekState.containerId,
    executor,
  );
  if (!currentParentEpoch) {
    throw new ContainerV2MutationError("Parent KEK state missing", 404);
  }

  const currentParentKeyEpoch = toContainerKeyEpoch(currentParentEpoch);
  const currentParentKeyEpochHash = await computeContainerKeyEpochHash(
    currentParentKeyEpoch,
  );

  if (
    parentKekState.containerKeyEpochId !== currentParentKeyEpoch.id ||
    parentKekState.keyEpochHash !== currentParentKeyEpochHash ||
    !canonicalJsonEquals(parentKekState.keyEpoch, currentParentKeyEpoch)
  ) {
    throw new ContainerV2MutationError("Parent KEK state is stale", 409);
  }
}

async function verifyContainerManifestFromRequest(
  request: ContainerV2MutationRequest,
  event: Awaited<ReturnType<typeof verifyMutationEvent>>,
): Promise<VerifiedContainerAccessManifest> {
  const destinationParentContainerPath = toVerifiedContainerManifestArray(
    request.destinationParentContainerPath,
  );
  const parentContainerPath = toVerifiedContainerManifestArray(
    request.parentContainerPath,
  );
  const previousContainerPath = toVerifiedContainerManifestArray(
    request.previousContainerPath,
  );
  const result = await verifyContainerAccessManifest({
    event,
    expectedManifestHash: request.expectedManifestHash,
    manifest: request.manifest as unknown as AccessManifestV2,
    previousManifest:
      request.previousManifest === undefined
        ? null
        : request.previousManifest === null
          ? null
          : toVerifiedContainerManifest(request.previousManifest),
    principalPolicies: principalPoliciesFromRequest(request),
    ...(destinationParentContainerPath !== undefined
      ? { destinationParentContainerPath }
      : {}),
    ...(parentContainerPath !== undefined ? { parentContainerPath } : {}),
    ...(previousContainerPath !== undefined ? { previousContainerPath } : {}),
  });

  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

function appendPathManifestHashes(
  hashes: string[],
  path: readonly ContainerV2ManifestBundle[] | undefined,
): void {
  if (!path) {
    return;
  }

  for (const manifest of path) {
    hashes.push(manifest.manifestHash);
  }
}

function expectedAccessEventDependencyHashes(
  request: ContainerV2MutationRequest,
  eventType: AccessEventTypeV2,
): string[] {
  const hashes: string[] = [];

  if (eventType === "container.create") {
    appendPathManifestHashes(hashes, request.parentContainerPath);
  } else {
    if (request.previousManifest) {
      hashes.push(request.previousManifest.manifestHash);
    }
    appendPathManifestHashes(hashes, request.previousContainerPath);

    if (eventType === "container.move") {
      appendPathManifestHashes(hashes, request.destinationParentContainerPath);
    }
  }

  return [...new Set(hashes)].sort();
}

function assertAccessEventDependenciesMatchRequest(
  request: ContainerV2MutationRequest,
  event: Awaited<ReturnType<typeof verifyMutationEvent>>,
): void {
  const expected = expectedAccessEventDependencyHashes(
    request,
    event.event.eventType,
  );
  const actual = [...event.event.dependencyManifestHashes].sort();

  if (
    expected.length !== actual.length ||
    expected.some((dependencyHash, index) => dependencyHash !== actual[index])
  ) {
    throw new ContainerV2MutationError(
      "Access event dependency hashes do not match supplied manifests",
      409,
    );
  }
}

async function verifyContainerKekFromRequest(
  executor: DatabaseExecutor,
  request: ContainerV2MutationRequest,
  manifest: VerifiedContainerAccessManifest,
): Promise<VerifiedContainerKekState> {
  const userRecipientKeys = userRecipientKeysFromRequest(request);
  const parentKekState = (request.parentKekState ??
    null) as unknown as VerifiedContainerKekState | null;

  await assertUserRecipientKeysCurrent(executor, userRecipientKeys);
  await assertParentKekStateCurrent(executor, manifest, parentKekState);

  const containerManifestHistory = toVerifiedContainerManifestArray(
    request.containerManifestHistory,
  );
  const result = await verifyContainerKekState({
    containerManifest: manifest,
    keyEpoch: request.keyEpoch as unknown as ContainerKeyEpochV2,
    parentKekState,
    principalPolicies: principalPoliciesFromRequest(request),
    userRecipientKeys,
    wraps: request.wraps as unknown as ContainerKeyWrapV2[],
    ...(containerManifestHistory !== undefined
      ? { containerManifestHistory }
      : {}),
  });

  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

async function loadContainerRow(
  executor: DatabaseExecutor,
  containerId: string,
): Promise<StoredContainerRow | null> {
  const [row] = await executor
    .select({
      id: containers.id,
      organizationId: containers.organizationId,
      parentId: containers.parentId,
    })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);

  return row ?? null;
}

async function persistContainerStructure(
  executor: DatabaseExecutor,
  manifest: VerifiedContainerAccessManifest,
): Promise<void> {
  const state = manifest.state;

  if (manifest.event.event.eventType === "container.create") {
    if (!state.parentContainerId) {
      throw new ContainerV2MutationError(
        "V2 container create requires a parent",
        400,
      );
    }

    const parent = await loadContainerRow(executor, state.parentContainerId);
    if (!parent) {
      throw new ContainerV2MutationError("Parent container not found", 404);
    }

    if (parent.organizationId !== state.organizationId) {
      throw new ContainerV2MutationError(
        "Parent container organization mismatch",
        409,
      );
    }

    const [inserted] = await executor
      .insert(containers)
      .values({
        id: state.containerId,
        organizationId: state.organizationId,
        parentId: state.parentContainerId,
      })
      .onConflictDoNothing({ target: containers.id })
      .returning({ id: containers.id });

    if (!inserted) {
      throw new ContainerV2MutationError("Container already exists", 409);
    }
    return;
  }

  const container = await loadContainerRow(executor, state.containerId);
  if (!container) {
    throw new ContainerV2MutationError("Container not found", 404);
  }

  if (container.organizationId !== state.organizationId) {
    throw new ContainerV2MutationError("Container organization mismatch", 409);
  }

  if (manifest.event.event.eventType !== "container.move") {
    return;
  }

  if (!container.parentId) {
    throw new ContainerV2MutationError("Root container cannot be moved", 400);
  }

  if (!state.parentContainerId) {
    throw new ContainerV2MutationError(
      "Destination parent container is required",
      400,
    );
  }

  const destinationParent = await loadContainerRow(
    executor,
    state.parentContainerId,
  );
  if (!destinationParent) {
    throw new ContainerV2MutationError(
      "Destination parent container not found",
      404,
    );
  }

  if (destinationParent.organizationId !== state.organizationId) {
    throw new ContainerV2MutationError(
      "Destination parent organization mismatch",
      409,
    );
  }

  await executor
    .update(containers)
    .set({ parentId: state.parentContainerId })
    .where(eq(containers.id, state.containerId));
}

async function persistVerifiedMutation(
  executor: DatabaseExecutor,
  manifest: VerifiedContainerAccessManifest,
  kekState: VerifiedContainerKekState,
): Promise<ContainerV2MutationResponse> {
  await persistContainerStructure(executor, manifest);

  const manifestHead = await storeVerifiedAccessManifest(
    { verifiedManifest: manifest as unknown as VerifiedAccessManifest },
    executor,
  );
  if (manifestHead.manifestHash !== manifest.manifestHash) {
    throw new ContainerV2MutationError("Container manifest head is stale", 409);
  }

  const storedKekState = await storeVerifiedContainerKekState(
    { verifiedState: kekState },
    executor,
  );

  return {
    containerId: manifest.state.containerId,
    organizationId: manifest.state.organizationId,
    parentId: manifest.state.parentContainerId,
    manifestHead: {
      epoch: manifestHead.epoch,
      manifestHash: manifestHead.manifestHash,
    },
    accessManifest: {
      event: manifest.event as unknown as Record<string, unknown>,
      manifest: manifest.manifest as unknown as Record<string, unknown>,
      manifestHash: manifest.manifestHash,
      state: manifest.state as unknown as Record<string, unknown>,
    },
    containerKek: {
      containerId: storedKekState.containerId,
      accessManifestHash: storedKekState.accessManifestHash,
      containerKeyEpochId: storedKekState.containerKeyEpochId,
      containerKeyEpoch: storedKekState.containerKeyEpoch,
      keyEpoch: storedKekState.keyEpoch as unknown as Record<string, unknown>,
      keyEpochHash: storedKekState.keyEpochHash,
      keyTargetHash: storedKekState.keyTargetHash,
      parentContainerKeyEpochId: storedKekState.parentContainerKeyEpochId,
      recipientTargets: storedKekState.recipientTargets.map((target) => ({
        ...target,
      })),
      wraps: storedKekState.wraps.map((wrap) => ({ ...wrap })),
    },
    referencedPrincipalHeads: manifest.manifest.referencedPrincipalHeads.map(
      (head) => ({ ...head }),
    ),
  };
}

export async function mutateContainerV2(
  runtime: ApiServiceRuntime,
  input: MutateContainerV2Input,
): Promise<ContainerV2MutationResponse> {
  try {
    return await runtime.db.transaction(async (tx) => {
      await assertCurrentContainerPath(
        tx,
        input.request.previousContainerPath,
        "previousContainerPath",
      );
      await assertCurrentContainerPath(
        tx,
        input.request.parentContainerPath,
        "parentContainerPath",
      );
      await assertCurrentContainerPath(
        tx,
        input.request.destinationParentContainerPath,
        "destinationParentContainerPath",
      );
      await assertHistoricalContainerManifestsConsistent(
        input.request.containerManifestHistory,
      );
      if (input.request.previousManifest) {
        const previousManifest = await assertContainerManifestBundleConsistent(
          input.request.previousManifest,
          "previousManifest",
        );
        await assertManifestHeadCurrent(
          tx,
          previousManifest,
          "previousManifest",
        );
      }
      await assertPrincipalPoliciesCurrent(
        tx,
        principalPoliciesFromRequest(input.request),
      );

      const event = await verifyMutationEvent(tx, input);
      assertAccessEventDependenciesMatchRequest(input.request, event);
      const manifest = await verifyContainerManifestFromRequest(
        input.request,
        event,
      );
      await assertMutationHeadCanAdvance(tx, manifest);
      const kekState = await verifyContainerKekFromRequest(
        tx,
        input.request,
        manifest,
      );

      return persistVerifiedMutation(tx, manifest, kekState);
    });
  } catch (error) {
    const mutationError = toMutationError(error);
    if (mutationError) {
      throw mutationError;
    }

    throw error;
  }
}
