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
  nullOnProjectionVerificationCancellation,
  type ProjectionUserKeyResolver,
  verifyContainerWriterProjection,
} from "../../../data/keyingProjectionVerification";
import {
  advanceVerifiedSharePolicies,
  loadVerifiedGroupSharePrincipalPolicy,
} from "../../containers";
import { createRuntimePrincipalPolicyWarmer } from "../../principals/runtimePolicyWarmer";
import type { ContainerContentsPersistence } from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import { loadContainerWriterProjectionForState } from "./projectionCache";
import {
  assertRemoteGroupShareName,
  shareRemoteContainer,
  shareRemoteContainerWithGroup,
} from "./remote";
import {
  type MatchingRemoteContainerGrant,
  persistDuplicateContainerShare,
  persistSharedContainerState,
} from "./sharePersistence";
import type {
  ContainerWorkflowRuntime,
  SharedContainerStateResult,
} from "./types";

type ContainerShareSubjectType = "group" | "user";
type ContainerShareAccessLevel = "read" | "write" | "admin";

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
  stillCurrent?: (() => boolean) | undefined;
}): Promise<number | null> {
  if (input.stillCurrent?.() === false) return null;
  const verified = await loadVerifiedGroupSharePrincipalPolicy({
    apiClient: input.runtime.apiClient,
    execSql: input.runtime.infra.execSql,
    groupId: input.groupId,
    organizationId: input.organizationId,
    resolveTrustedUserIdentity: input.runtime.resolveTrustedUserIdentity,
    stillCurrent: input.stillCurrent,
  });
  if (input.stillCurrent?.() === false) return null;
  // Commit the verification immediately: this read stands alone (no enclosing
  // mutation advances it later), and an unadvanced checkpoint would let a
  // newer same-epoch policy be rolled back on the next fetch.
  await advanceVerifiedSharePolicies(
    input.runtime.infra.execSql,
    verified,
    input.stillCurrent,
  );
  return input.stillCurrent?.() === false ? null : verified.policy.keyEpoch;
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
  stillCurrent?: (() => boolean) | undefined;
  subjectId: string;
  subjectType: ContainerShareSubjectType;
}): Promise<RemoteContainerShareContext | null> {
  if (input.stillCurrent?.() === false) return null;
  const projection = await loadContainerWriterProjectionForState({
    containerState: input.containerState,
    runtime: input.runtime,
  });
  if (!projection || input.stillCurrent?.() === false) {
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
    const currentKeyEpoch = pinnedHead
      ? await resolveCurrentGroupKeyEpoch({
          groupId: input.subjectId,
          organizationId: remoteState.organizationId,
          runtime: input.runtime,
          stillCurrent: input.stillCurrent,
        })
      : null;
    if (input.stillCurrent?.() === false) return null;
    if (
      !pinnedHead ||
      (currentKeyEpoch !== null &&
        groupGrantIsStale({
          currentKeyEpoch,
          referencedPrincipalHeads: remoteState.referencedPrincipalHeads,
          subjectId: input.subjectId,
        }))
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

async function prepareContainerStateGroupRewrapInternal(input: {
  accessLevel: ContainerShareAccessLevel;
  containerState: ContainerState;
  groupId: string;
  requireExistingGrant?: boolean | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<
  | { status: "not-granted" }
  | {
      knownContainerKeks: ReadonlyMap<string, Uint8Array>;
      status: "prepared";
    }
  | null
> {
  if (input.stillCurrent?.() === false) return null;
  const projection = await loadContainerWriterProjectionForState({
    containerState: input.containerState,
    runtime: input.runtime,
  });
  if (!projection || input.stillCurrent?.() === false) {
    return null;
  }

  if (input.requireExistingGrant) {
    await verifyContainerWriterProjection({
      execSql: input.runtime.infra.execSql,
      projection,
      resolveUserKey: input.resolveProjectionUserKey,
      stillCurrent: input.stillCurrent,
      warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
        input.runtime,
      ),
    });
    if (input.stillCurrent?.() === false) return null;
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
    stillCurrent: input.stillCurrent,
    warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      input.runtime,
    ),
  });
  if (input.stillCurrent?.() === false) return null;
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

export function prepareContainerStateGroupRewrap(
  input: Parameters<typeof prepareContainerStateGroupRewrapInternal>[0],
): ReturnType<typeof prepareContainerStateGroupRewrapInternal> {
  return nullOnProjectionVerificationCancellation(() =>
    prepareContainerStateGroupRewrapInternal(input),
  );
}

export async function shareContainerState(input: {
  accessLevel: ContainerShareAccessLevel;
  containerState: ContainerState;
  persistence: ContainerContentsPersistence;
  recipientUserId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<SharedContainerStateResult | null> {
  if (input.stillCurrent?.() === false) return null;
  const shareContext = await loadRemoteContainerShareContext({
    accessLevel: input.accessLevel,
    containerState: input.containerState,
    runtime: input.runtime,
    stillCurrent: input.stillCurrent,
    subjectId: input.recipientUserId,
    subjectType: "user",
  });
  if (!shareContext || input.stillCurrent?.() === false) {
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
      stillCurrent: input.stillCurrent,
    });
  }

  const shared = await shareRemoteContainer({
    accessLevel: input.accessLevel,
    containerId: input.containerState.container.id,
    previousProjection: shareContext.projection,
    recipientUserId: input.recipientUserId,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    runtime: input.runtime,
    stillCurrent: input.stillCurrent,
  });

  if (!shared || input.stillCurrent?.() === false) {
    return null;
  }

  return persistSharedContainerState({
    containerState: input.containerState,
    persistence: input.persistence,
    runtime: input.runtime,
    shared,
    stillCurrent: input.stillCurrent,
  });
}

export async function shareContainerStateWithGroup(input: {
  accessLevel: ContainerShareAccessLevel;
  containerState: ContainerState;
  expectedGroupName?: string | undefined;
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
  stillCurrent?: (() => boolean) | undefined;
}): Promise<SharedContainerStateResult | null> {
  // A share chosen by name must carry that name so it can be bound to the
  // signed group policy. Only the grant-preserving re-wrap, which never mints
  // a grant, may run without one. Enforced here, in the workflow facade, so
  // every caller (not only the store) meets the invariant.
  if (!input.requireExistingGrant && input.expectedGroupName === undefined) {
    throw new Error("Container group share requires the chosen group name");
  }
  if (input.stillCurrent?.() === false) return null;
  const shareContext = await loadRemoteContainerShareContext({
    accessLevel: input.accessLevel,
    containerState: input.containerState,
    forceExistingGrantRewrap:
      input.requireExistingGrant && input.knownContainerKeks !== undefined,
    requireExistingGrant: input.requireExistingGrant,
    runtime: input.runtime,
    stillCurrent: input.stillCurrent,
    subjectId: input.recipientGroupId,
    subjectType: "group",
  });
  if (!shareContext || input.stillCurrent?.() === false) {
    return null;
  }
  if (shareContext.matchingGrant) {
    // A duplicate share mints nothing, but it must not report success for a
    // group the user did not choose: bind the chosen name before skipping.
    if (
      input.expectedGroupName !== undefined &&
      !(await assertRemoteGroupShareName({
        expectedGroupName: input.expectedGroupName,
        groupId: input.recipientGroupId,
        runtime: input.runtime,
        stillCurrent: input.stillCurrent,
      }))
    ) {
      return null;
    }
    if (input.stillCurrent?.() === false) return null;
    input.runtime.util.log(
      `Container contents: skipped duplicate share for container ${input.containerState.container.id} with group ${input.recipientGroupId}`,
    );
    return persistDuplicateContainerShare({
      containerState: input.containerState,
      grant: shareContext.matchingGrant,
      persistence: input.persistence,
      projection: shareContext.projection,
      runtime: input.runtime,
      stillCurrent: input.stillCurrent,
    });
  }

  const shared = await shareRemoteContainerWithGroup({
    accessLevel: input.accessLevel,
    containerId: input.containerState.container.id,
    expectedGroupName: input.expectedGroupName,
    knownContainerKeks: input.knownContainerKeks,
    previousProjection: shareContext.projection,
    recipientGroupId: input.recipientGroupId,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    runtime: input.runtime,
    stillCurrent: input.stillCurrent,
  });

  if (!shared || input.stillCurrent?.() === false) {
    return null;
  }

  return persistSharedContainerState({
    containerState: input.containerState,
    persistence: input.persistence,
    runtime: input.runtime,
    shared,
    stillCurrent: input.stillCurrent,
  });
}
