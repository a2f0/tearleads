import type {
  ContainerWriterProjectionResponse,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import {
  getTargetContainerContext,
  readContainerState,
} from "../../../data/containers/shared/projection";
import { unwrapContainerKekPath } from "../../../data/documents/shared/projection";
import {
  type ProjectionUserKeyResolver,
  verifyContainerWriterProjection,
} from "../../../data/keyingProjectionVerification";
import { loadVerifiedGroupSharePrincipalPolicy } from "../../containers";
import { createRuntimePrincipalPolicyWarmer } from "../../principals/runtimePolicyWarmer";
import type { ContainerContentsPersistence } from "../containerPersistence";
import type { ContainerMetadataPatch } from "../metadata";
import { persistContainerMetadataStateFromRuntime } from "../metadata";
import type { ContainerState } from "../remoteHydration";
import { loadContainerWriterProjectionForState } from "./projectionCache";
import { shareRemoteContainer, shareRemoteContainerWithGroup } from "./remote";
import type {
  ContainerWorkflowRuntime,
  SharedContainerState,
  SharedRemoteContainerState,
} from "./types";

type ContainerShareSubjectType = "group" | "user";
type ContainerShareAccessLevel = "read" | "write" | "admin";

interface MatchingRemoteContainerGrant {
  accessEpoch: number;
  accessStateHash: string;
  createdAt: string | null;
  metadataDocumentId: string;
  referencedPrincipalHeads: ReadonlyArray<ReferencedPrincipalStateResponse>;
  updatedAt: string | null;
}

interface RemoteContainerShareContext {
  matchingGrant: MatchingRemoteContainerGrant | null;
  projection: ContainerWriterProjectionResponse;
}

function readOptionalProjectionString(
  projection: ContainerWriterProjectionResponse,
  key: string,
): string | null {
  const value = Reflect.get(projection, key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function resolveCurrentGroupKeyEpoch(input: {
  groupId: string;
  organizationId: string;
  runtime: ContainerWorkflowRuntime;
}): Promise<number> {
  const verified = await loadVerifiedGroupSharePrincipalPolicy({
    apiClient: input.runtime.apiClient,
    execSql: input.runtime.infra.execSql,
    groupId: input.groupId,
    organizationId: input.organizationId,
    resolveTrustedUserIdentity: input.runtime.resolveTrustedUserIdentity,
  });
  return verified.policy.keyEpoch;
}

// A container's KEK is wrapped to a group's encapsulation key at a specific key
// epoch, pinned into the manifest as a referenced principal head. When the group
// rotates (org-admin add or any removal bumps the epoch and mints a fresh KEM
// keypair), that wrap goes stale: members holding only the new epoch secret can
// no longer unwrap it. A re-share to the same group at the same access level is
// therefore NOT redundant when the pinned epoch trails the group's current head,
// so it must not be deduped away. The current epoch comes from a network-fresh,
// fully verified policy bundle guarded by any durable local checkpoint.
function groupGrantIsStale(input: {
  currentKeyEpoch: number;
  referencedPrincipalHeads: ReadonlyArray<ReferencedPrincipalStateResponse>;
  subjectId: string;
}): boolean {
  const pinnedHead = (input.referencedPrincipalHeads ?? []).find(
    (head) =>
      head.principalType === "group" && head.principalId === input.subjectId,
  );
  if (!pinnedHead) {
    return true;
  }
  return pinnedHead.keyEpoch !== input.currentKeyEpoch;
}

async function loadRemoteContainerShareContext(input: {
  accessLevel: ContainerShareAccessLevel;
  containerState: ContainerState;
  forceExistingGrantRewrap?: boolean | undefined;
  requireExistingGrant?: boolean | undefined;
  runtime: ContainerWorkflowRuntime;
  subjectId: string;
  subjectType: ContainerShareSubjectType;
}): Promise<RemoteContainerShareContext | null> {
  const projection = await loadContainerWriterProjectionForState({
    containerState: input.containerState,
    runtime: input.runtime,
  });
  if (!projection) {
    return null;
  }

  const target = getTargetContainerContext(projection);
  const remoteState = readContainerState(target.manifest);
  const hasMatchingGrant = remoteState.directGrants.some(
    (grant) =>
      grant.subjectType === input.subjectType &&
      grant.subjectId === input.subjectId &&
      grant.accessLevel === input.accessLevel,
  );
  if (!hasMatchingGrant) {
    if (input.requireExistingGrant) {
      // Re-wrap-only callers must never mint a brand-new grant: the container's
      // system slot is server-supplied and could point at a container that does
      // not already grant this subject, so minting here would leak its contents.
      input.runtime.util.log(
        `Container contents: refused to create a new ${input.subjectType} grant for ${input.subjectId} on container ${input.containerState.container.id} because the re-share requires an existing grant`,
      );
      return null;
    }
    return { matchingGrant: null, projection };
  }

  if (
    input.subjectType === "group" &&
    input.requireExistingGrant &&
    input.forceExistingGrantRewrap
  ) {
    // The cheap epoch probe below reads an unverified response and cannot prove
    // that a security-critical re-wrap is current. Force the verified policy
    // load and a real same-level mutation; failures must reach the retry owner.
    input.runtime.util.log(
      `Container contents: re-sharing container ${input.containerState.container.id} with group ${input.subjectId} because an existing grant re-wrap is required`,
    );
    return { matchingGrant: null, projection };
  }

  if (input.subjectType === "group") {
    const pinnedHead = remoteState.referencedPrincipalHeads.find(
      (head) =>
        head.principalType === "group" && head.principalId === input.subjectId,
    );
    if (
      !pinnedHead ||
      groupGrantIsStale({
        currentKeyEpoch: await resolveCurrentGroupKeyEpoch({
          groupId: input.subjectId,
          organizationId: remoteState.organizationId,
          runtime: input.runtime,
        }),
        referencedPrincipalHeads: remoteState.referencedPrincipalHeads,
        subjectId: input.subjectId,
      })
    ) {
      input.runtime.util.log(
        `Container contents: re-sharing container ${input.containerState.container.id} with group ${input.subjectId} because its key epoch advanced past the pinned grant`,
      );
      return { matchingGrant: null, projection };
    }
  }

  return {
    matchingGrant: {
      accessEpoch: remoteState.epoch,
      accessStateHash: target.manifest.manifestHash,
      createdAt: readOptionalProjectionString(projection, "createdAt"),
      metadataDocumentId: remoteState.metadataDocumentId,
      referencedPrincipalHeads: remoteState.referencedPrincipalHeads,
      updatedAt: readOptionalProjectionString(projection, "updatedAt"),
    },
    projection,
  };
}

async function persistSharedContainerState(input: {
  containerState: ContainerState;
  persistence: ContainerContentsPersistence;
  runtime: ContainerWorkflowRuntime;
  shared: SharedRemoteContainerState;
}): Promise<SharedContainerState> {
  await createRuntimePrincipalPolicyWarmer(input.runtime)({
    organizationId: input.shared.writerProjection.organizationId,
    references: input.shared.referencedPrincipalHeads,
  });
  input.containerState.container = {
    ...input.containerState.container,
    createdAt: input.shared.createdAt,
    serverCreatedAt: input.shared.createdAt,
    serverUpdatedAt: input.shared.updatedAt,
    updatedAt: input.shared.updatedAt,
  };

  const persisted = await persistContainerMetadataStateFromRuntime({
    metadataState: input.containerState,
    patch: {
      accessEpoch: input.shared.accessEpoch,
      accessStateHash: input.shared.accessManifestHash,
      documentId: input.shared.metadataDocumentId,
      metadataDocumentId: input.shared.metadataDocumentId,
      contentKeyBundle: null,
      documentKekTargets: null,
      documentManifestBundle: null,
    },
    persistence: input.persistence,
    runtime: input.runtime,
  });
  input.containerState.containerWriterProjection =
    input.shared.writerProjection;

  return {
    container: persisted.container,
    record: persisted.record,
  };
}

async function persistDuplicateContainerShare(input: {
  containerState: ContainerState;
  grant: MatchingRemoteContainerGrant;
  persistence: ContainerContentsPersistence;
  projection: ContainerWriterProjectionResponse;
  runtime: ContainerWorkflowRuntime;
}): Promise<SharedContainerState> {
  await createRuntimePrincipalPolicyWarmer(input.runtime)({
    organizationId: input.projection.organizationId,
    references: input.grant.referencedPrincipalHeads,
  });
  input.containerState.container = {
    ...input.containerState.container,
    ...(input.grant.createdAt
      ? {
          createdAt: input.grant.createdAt,
          serverCreatedAt: input.grant.createdAt,
        }
      : {}),
    ...(input.grant.updatedAt
      ? {
          serverUpdatedAt: input.grant.updatedAt,
          updatedAt: input.grant.updatedAt,
        }
      : {}),
  };
  const securityContextChanged =
    input.containerState.record.documentId !== input.grant.metadataDocumentId ||
    input.containerState.record.accessEpoch !== input.grant.accessEpoch ||
    input.containerState.record.accessStateHash !== input.grant.accessStateHash;
  const patch: Partial<ContainerMetadataPatch> = {
    accessEpoch: input.grant.accessEpoch,
    accessStateHash: input.grant.accessStateHash,
    documentId: input.grant.metadataDocumentId,
    metadataDocumentId: input.grant.metadataDocumentId,
    ...(securityContextChanged
      ? {
          contentKeyBundle: null,
          documentKekTargets: null,
          documentManifestBundle: null,
        }
      : {}),
  };
  const persisted = await persistContainerMetadataStateFromRuntime({
    metadataState: input.containerState,
    patch,
    persistence: input.persistence,
    runtime: input.runtime,
  });
  input.containerState.containerWriterProjection = input.projection;

  return {
    container: persisted.container,
    record: persisted.record,
  };
}

export async function prepareContainerStateGroupRewrap(input: {
  accessLevel: ContainerShareAccessLevel;
  containerState: ContainerState;
  groupId: string;
  requireExistingGrant?: boolean | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}): Promise<
  | { status: "not-granted" }
  | {
      knownContainerKeks: ReadonlyMap<string, Uint8Array>;
      status: "prepared";
    }
  | null
> {
  const projection = await loadContainerWriterProjectionForState({
    containerState: input.containerState,
    runtime: input.runtime,
  });
  if (!projection) {
    return null;
  }

  if (input.requireExistingGrant) {
    await verifyContainerWriterProjection({
      execSql: input.runtime.infra.execSql,
      projection,
      resolveUserKey: input.resolveProjectionUserKey,
      warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
        input.runtime,
      ),
    });
    const verifiedState = readContainerState(
      getTargetContainerContext(projection).manifest,
    );
    if (
      projection.containerId !== input.containerState.container.id ||
      projection.organizationId !==
        input.containerState.container.organizationId ||
      verifiedState.containerId !== input.containerState.container.id ||
      verifiedState.organizationId !==
        input.containerState.container.organizationId ||
      verifiedState.parentContainerId !==
        input.containerState.container.parentId
    ) {
      throw new Error(
        "Prepared container group re-wrap target is inconsistent",
      );
    }
    const hasGrant = verifiedState.directGrants.some(
      (grant) =>
        grant.subjectType === "group" &&
        grant.subjectId === input.groupId &&
        grant.accessLevel === input.accessLevel,
    );
    if (!hasGrant) {
      return { status: "not-granted" };
    }
  }

  const targetSecretKey =
    input.runtime.crypto.encapsulationKeyPair?.secretKey ?? null;
  if (!targetSecretKey) {
    return null;
  }

  const target = getTargetContainerContext(projection);
  const keksByEpochId = await unwrapContainerKekPath({
    execSql: input.runtime.infra.execSql,
    projection,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    secretKey: targetSecretKey,
    warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      input.runtime,
    ),
  });
  const targetKek = keksByEpochId.get(target.kek.containerKeyEpochId);
  return targetKek
    ? {
        knownContainerKeks: new Map([
          [target.kek.containerKeyEpochId, targetKek],
        ]),
        status: "prepared",
      }
    : null;
}

export async function shareContainerState(input: {
  accessLevel: ContainerShareAccessLevel;
  containerState: ContainerState;
  persistence: ContainerContentsPersistence;
  recipientUserId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}): Promise<SharedContainerState | null> {
  const shareContext = await loadRemoteContainerShareContext({
    accessLevel: input.accessLevel,
    containerState: input.containerState,
    runtime: input.runtime,
    subjectId: input.recipientUserId,
    subjectType: "user",
  });
  if (!shareContext) {
    return null;
  }
  if (shareContext.matchingGrant) {
    input.runtime.util.log(
      `Container contents: skipped duplicate share for container ${input.containerState.container.id} with user ${input.recipientUserId}`,
    );
    return persistDuplicateContainerShare({
      containerState: input.containerState,
      grant: shareContext.matchingGrant,
      persistence: input.persistence,
      projection: shareContext.projection,
      runtime: input.runtime,
    });
  }

  const shared = await shareRemoteContainer({
    accessLevel: input.accessLevel,
    containerId: input.containerState.container.id,
    previousProjection: shareContext.projection,
    recipientUserId: input.recipientUserId,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    runtime: input.runtime,
  });

  if (!shared) {
    return null;
  }

  return persistSharedContainerState({
    containerState: input.containerState,
    persistence: input.persistence,
    runtime: input.runtime,
    shared,
  });
}

export async function shareContainerStateWithGroup(input: {
  accessLevel: ContainerShareAccessLevel;
  containerState: ContainerState;
  knownContainerKeks?: ReadonlyMap<string, Uint8Array> | undefined;
  persistence: ContainerContentsPersistence;
  recipientGroupId: string;
  // When set, a re-share only re-wraps an already-granted group and never mints
  // a new grant. Used by organization access repair so a server cannot redirect
  // the operation onto a container the group is not entitled to. A prepared
  // re-wrap also supplies captured KEKs and must submit a real mutation.
  requireExistingGrant?: boolean | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}): Promise<SharedContainerState | null> {
  const shareContext = await loadRemoteContainerShareContext({
    accessLevel: input.accessLevel,
    containerState: input.containerState,
    forceExistingGrantRewrap:
      input.requireExistingGrant && input.knownContainerKeks !== undefined,
    requireExistingGrant: input.requireExistingGrant,
    runtime: input.runtime,
    subjectId: input.recipientGroupId,
    subjectType: "group",
  });
  if (!shareContext) {
    return null;
  }
  if (shareContext.matchingGrant) {
    input.runtime.util.log(
      `Container contents: skipped duplicate share for container ${input.containerState.container.id} with group ${input.recipientGroupId}`,
    );
    return persistDuplicateContainerShare({
      containerState: input.containerState,
      grant: shareContext.matchingGrant,
      persistence: input.persistence,
      projection: shareContext.projection,
      runtime: input.runtime,
    });
  }

  const shared = await shareRemoteContainerWithGroup({
    accessLevel: input.accessLevel,
    containerId: input.containerState.container.id,
    knownContainerKeks: input.knownContainerKeks,
    previousProjection: shareContext.projection,
    recipientGroupId: input.recipientGroupId,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    runtime: input.runtime,
  });

  if (!shared) {
    return null;
  }

  return persistSharedContainerState({
    containerState: input.containerState,
    persistence: input.persistence,
    runtime: input.runtime,
    shared,
  });
}
