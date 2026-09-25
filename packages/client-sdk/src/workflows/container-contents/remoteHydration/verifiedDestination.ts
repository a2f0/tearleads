import {
  type AccessManifestCheckpoint,
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import {
  verifiedContainerCreateManifest,
  verifyContainerDestinationProjection,
} from "../../../data/keyingProjectionVerification/containerDestinationVerification";
import { verifyContainerWriterProjection } from "../../../data/keyingProjectionVerification/containerProjectionVerification";
import {
  reportKeyingVerificationErrorInCauseChain,
  runWithSecurityIncidentReporting,
} from "../../../data/keyingProjectionVerification/error";
import { createGroupMetadataContainerVerifier } from "../../organizations/groupMetadataContainerAuthority";
import { createRuntimePrincipalPolicyWarmer } from "../../principals/runtimePolicyWarmer";
import {
  cachedDestinationRole,
  type DestinationRole,
  rememberDestinationRole,
} from "./destinationRoleCache";
import type {
  ContainerState,
  RemoteContainer,
  RemoteContainerHydrationState,
} from "./types";

/** The identity a role is verified and cached under. */
type DestinationIdentity = Pick<RemoteContainer, "id" | "organizationId">;

export function needsVerifiedContainerDestination(input: {
  remoteContainer: RemoteContainer;
  state: RemoteContainerHydrationState;
}): boolean {
  const listed = input.remoteContainer;
  const existing = input.state.containersById.get(listed.id)?.container;
  return (
    !!listed.systemSlot ||
    !!existing?.systemSlot ||
    listed.parentId === null ||
    existing?.parentId === null
  );
}

async function destinationRoleFromPath(input: {
  listed: DestinationIdentity;
  path: readonly VerifiedContainerAccessManifest[];
  verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): Promise<DestinationRole> {
  const { listed, path } = input;
  const head = path.at(-1);
  if (
    !head ||
    head.state.containerId !== listed.id ||
    head.state.organizationId !== listed.organizationId
  ) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "container destination manifest has the wrong identity",
    );
  }
  const metadataSlot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId: listed.organizationId,
  });
  if (
    head.state.systemSlot !== null &&
    path.length !== (head.state.systemSlot === metadataSlot ? 1 : 2)
  ) {
    throw new KeyingVerificationError(
      "invalid_shape",
      "system destination has the wrong signed topology",
    );
  }
  // The head may be a later grant signed by any admin; only the epoch-1
  // create names the creator, and roots are always created by the org owner.
  const created = verifiedContainerCreateManifest({
    head,
    label: "Container destination",
    verifiedByHash: input.verifiedByHash,
  });
  return {
    createSignerUserId: created.event.event.signerUserId,
    metadataDocumentId: head.state.metadataDocumentId,
    parentId: head.state.parentContainerId,
    systemSlot: head.state.systemSlot,
  };
}

/**
 * The session's root id arrives in an unsigned login response, so the root it
 * names must prove it belongs to this user: every acknowledged organization was
 * created by the session user, whose device signed the root's `container.create`.
 * A verified root created by anyone else is a substitution, never the merge
 * target for pre-login local content, whatever grants it carries. The check
 * runs on cache reuse too, since the cache is not scoped to the session user.
 */
function assertRootCreatedBySessionUser(
  role: DestinationRole,
  runtime: RemoteContainerHydrationState["runtime"],
): void {
  if (role.systemSlot !== null) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "acknowledged session root cannot be a system container",
    );
  }
  if (role.createSignerUserId !== runtime.auth.userId) {
    throw new KeyingVerificationError(
      "signer_mismatch",
      "acknowledged session root was not created by the session user",
    );
  }
}

function assertAcknowledgedRootSigner(input: {
  listed: DestinationIdentity;
  role: DestinationRole;
  runtime: RemoteContainerHydrationState["runtime"];
}): void {
  const { listed, role, runtime } = input;
  if (role.parentId !== null || listed.id !== runtime.auth.rootContainerId) {
    return;
  }
  assertRootCreatedBySessionUser(role, runtime);
}

async function verifyDestinationRole(input: {
  verifyCurrentPlacement: boolean;
  onVerifiedCheckpoint:
    | ((checkpoint: AccessManifestCheckpoint) => void)
    | undefined;
  isCurrent?: (() => boolean) | undefined;
  listed: DestinationIdentity;
  runtime: RemoteContainerHydrationState["runtime"];
}): Promise<DestinationRole | null> {
  const { isCurrent, listed, runtime } = input;
  const projection = await runtime.apiClient.getContainerWriterProjection(
    listed.id,
  );
  if (!projection || isCurrent?.() === false) return null;
  if (
    projection.containerId !== listed.id ||
    projection.organizationId !== listed.organizationId
  ) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "container destination projection has the wrong identity",
    );
  }
  const verificationInput = {
    execSql: runtime.infra.execSql,
    projection,
    resolveUserKey: runtime.resolveTrustedUserIdentity,
    warmReferencedPrincipalPolicies:
      createRuntimePrincipalPolicyWarmer(runtime),
  };
  const { path, verifiedByHash } =
    await verifyContainerDestinationProjection(verificationInput);
  if (isCurrent?.() === false) return null;
  const role = await destinationRoleFromPath({ listed, path, verifiedByHash });
  if (role.parentId === null && role.systemSlot !== null) {
    const head = path.at(-1);
    if (!head) throw new Error("Metadata root manifest is unavailable");
    await createGroupMetadataContainerVerifier({
      apiClient: runtime.apiClient,
      execSql: runtime.infra.execSql,
      organizationId: listed.organizationId,
      resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
      stillCurrent: isCurrent ?? (() => true),
    })(head.state);
  }
  if (isCurrent?.() === false) return null;
  if (input.verifyCurrentPlacement) {
    // Check the immutable role before allowing current placement to advance pins.
    assertAcknowledgedRootSigner({ listed, role, runtime });
    const currentPath = await verifyContainerWriterProjection({
      ...verificationInput,
      stillCurrent: isCurrent,
    });
    const currentHead = currentPath.at(-1);
    if (!currentHead)
      throw new Error("Recovery placement manifest is unavailable");
    input.onVerifiedCheckpoint?.(currentHead.checkpoint);
  }
  if (isCurrent?.() === false) return null;
  rememberDestinationRole(runtime.infra.execSql, listed, role);
  return role;
}

/** Listing hints may trigger a fetch, but never establish a system/root role. */
export async function verifyRemoteContainerDestination(input: {
  refresh?: boolean;
  onVerifiedCheckpoint?:
    | ((checkpoint: AccessManifestCheckpoint) => void)
    | undefined;
  remoteContainer: RemoteContainer;
  state: RemoteContainerHydrationState;
  isCurrent?: (() => boolean) | undefined;
}): Promise<RemoteContainer | null> {
  const { remoteContainer: listed, state, isCurrent } = input;
  const runtime = state.runtime;
  return runWithSecurityIncidentReporting(
    runtime.util.reportSecurityIncident,
    {
      objectId: listed.id,
      objectKind: "container",
      operation: "container.destination.verify",
      organizationId: listed.organizationId,
    },
    async () => {
      if (input.refresh)
        runtime.apiClient.evictContainerWriterProjection(listed.id);
      const role =
        (input.refresh
          ? undefined
          : cachedDestinationRole(runtime.infra.execSql, listed)) ??
        (await verifyDestinationRole({
          isCurrent,
          listed,
          runtime,
          verifyCurrentPlacement: input.refresh === true,
          onVerifiedCheckpoint: input.onVerifiedCheckpoint,
        }));
      if (!role || isCurrent?.() === false) return null;
      assertAcknowledgedRootSigner({ listed, role, runtime });
      return {
        ...listed,
        metadataDocumentId: role.metadataDocumentId,
        parentId: role.parentId,
        systemSlot: role.systemSlot,
      };
    },
  );
}

/** The root the unsigned login answer named, in the expected organization. */
export function isSessionRootState(
  remoteRootState: ContainerState,
  state: RemoteContainerHydrationState,
): boolean {
  const { container } = remoteRootState;
  const { auth } = state.runtime;
  return (
    container.parentId === null &&
    !container.systemSlot &&
    container.id === auth.rootContainerId &&
    container.organizationId === auth.organizationId
  );
}

/**
 * Whether the session root may absorb the pre-login local roots. The unsigned
 * login answer only names the root; the merge target must also be the verified
 * root whose epoch-1 `container.create` the session user signed. A row persisted
 * earlier as an ordinary shared container (another user's root this device once
 * hydrated) never passed that check for this session, so the creator is checked
 * here, at the reconciliation boundary itself, before any local content is
 * re-parented. The role comes only from the cache remote hydration fills when
 * it verifies the destination: this gate never fetches, so a local refresh stays
 * independent of the network. Without a cached role the merge is left pending
 * (no incident) until hydration verifies the root and reconciles from the
 * cache. A different creator is a `signer_mismatch` incident and never a merge;
 * the refusal is the "no merge" outcome, so the refresh that carried it
 * completes with the local content left in place.
 */
export async function isVerifiedLocalRootReconciliationTarget(input: {
  remoteRootState: ContainerState;
  state: RemoteContainerHydrationState;
}): Promise<boolean> {
  const { remoteRootState, state } = input;
  const { container } = remoteRootState;
  const runtime = state.runtime;
  if (!isSessionRootState(remoteRootState, state)) return false;
  const role = cachedDestinationRole(runtime.infra.execSql, container);
  if (!role) return false;
  try {
    if (role.parentId !== null) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "session root reconciliation target is not a verified root",
      );
    }
    assertRootCreatedBySessionUser(role, runtime);
    return true;
  } catch (error) {
    const reported = await reportKeyingVerificationErrorInCauseChain(
      error,
      runtime.util.reportSecurityIncident,
      {
        objectId: container.id,
        objectKind: "container",
        operation: "container.root.reconcile",
        organizationId: container.organizationId,
      },
    );
    if (!reported) throw error;
    return false;
  }
}
