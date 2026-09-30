import {
  type AccessManifestCheckpoint,
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import {
  assertHeldContainerBinding,
  type HeldContainerBinding,
  listingRepeatsHeldOrdinaryBinding,
} from "../../../data/containers/containerBinding";
import {
  verifiedContainerCreateManifest,
  verifyContainerDestinationProjection,
} from "../../../data/keyingProjectionVerification/containerDestinationVerification";
import { verifyContainerWriterProjection } from "../../../data/keyingProjectionVerification/containerProjectionVerification";
import {
  isKeyingVerificationError,
  reportKeyingVerificationErrorInCauseChain,
  runWithSecurityIncidentReporting,
} from "../../../data/keyingProjectionVerification/error";
import { createGroupMetadataContainerVerifier } from "../../organizations/groupMetadataContainerAuthority";
import type { PrefetchedDestinationProjection } from "./destinationPrefetch";
import {
  cachedDestinationRole,
  type DestinationRole,
  rememberDestinationRole,
} from "./destinationRoleCache";
import { resolveWithMetadataRootReload } from "./destinationRootReload";
import type {
  ContainerState,
  RemoteContainer,
  RemoteContainerHydrationState,
} from "./types";

/** The identity a role is verified and cached under. */
type DestinationIdentity = Pick<RemoteContainer, "id" | "organizationId">;

async function destinationRoleFromPath(input: {
  listed: DestinationIdentity;
  path: readonly VerifiedContainerAccessManifest[];
  verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): Promise<{ role: DestinationRole; parentId: string | null }> {
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
    parentId: head.state.parentContainerId,
    role: {
      createSignerUserId: created.event.event.signerUserId,
      metadataDocumentId: head.state.metadataDocumentId,
      ...(head.state.parentContainerId === null ||
      head.state.systemSlot !== null
        ? { parentId: head.state.parentContainerId }
        : {}),
      systemSlot: head.state.systemSlot,
    },
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

/**
 * A held folder keeps its binding unless its new copy was created by this
 * session's own user: purged-organization recovery re-homes folders under their
 * existing ids. Any other signer cannot move a held folder, and an unbound one
 * (a pending create or reset) binds only to its own user's create.
 */
function assertPermittedDestinationBinding(input: {
  heldBinding: HeldContainerBinding | null;
  listed: DestinationIdentity;
  role: DestinationRole;
  runtime: RemoteContainerHydrationState["runtime"];
}): void {
  const { heldBinding, listed, role, runtime } = input;
  if (role.createSignerUserId === runtime.auth.userId) return;
  // An unbound held folder awaits this device's own create.
  if (heldBinding?.metadataDocumentId === null) {
    throw new KeyingVerificationError(
      "signer_mismatch",
      "a local folder can bind only to its own signed create",
    );
  }
  assertHeldContainerBinding(heldBinding, {
    organizationId: listed.organizationId,
    metadataDocumentIds: [role.metadataDocumentId],
  });
}

async function verifyDestinationRole(input: {
  heldBinding: HeldContainerBinding | null;
  prefetched: PrefetchedDestinationProjection | undefined;
  verifyCurrentPlacement: boolean;
  onVerifiedCheckpoint:
    | ((checkpoint: AccessManifestCheckpoint) => void)
    | undefined;
  isCurrent?: (() => boolean) | undefined;
  listed: DestinationIdentity;
  runtime: RemoteContainerHydrationState["runtime"];
}): Promise<{ role: DestinationRole; parentId: string | null } | null> {
  const { isCurrent, listed, runtime } = input;
  const projection = input.prefetched
    ? input.prefetched.projection
    : await runtime.apiClient.getContainerWriterProjection(listed.id);
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
  };
  const { path, verifiedByHash } =
    await verifyContainerDestinationProjection(verificationInput);
  if (isCurrent?.() === false) return null;
  const destination = await destinationRoleFromPath({
    listed,
    path,
    verifiedByHash,
  });
  const { role } = destination;
  // Refuse a rebinding before group checks or placement pins run for it.
  assertPermittedDestinationBinding({
    heldBinding: input.heldBinding,
    listed,
    role,
    runtime,
  });
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
  return destination;
}

type VerifyRemoteContainerDestinationInput = {
  heldBinding: HeldContainerBinding | null;
  /** The held folder was re-homed away from the listed organization. */
  supersededListing?: boolean | undefined;
  /** Fetched ahead by page hydration; ignored when placement is refreshed. */
  prefetchedProjection?: PrefetchedDestinationProjection | undefined;
  refresh?: boolean;
  onVerifiedCheckpoint?:
    | ((checkpoint: AccessManifestCheckpoint) => void)
    | undefined;
  remoteContainer: RemoteContainer;
  state: RemoteContainerHydrationState;
  isCurrent?: (() => boolean) | undefined;
};

/** A cached immutable role, or a freshly verified one with its signed parent. */
async function resolveDestinationRole(
  input: VerifyRemoteContainerDestinationInput,
): Promise<{
  freshlyVerified: boolean;
  parentId: string | null | undefined;
  role: DestinationRole;
} | null> {
  const { remoteContainer: listed, isCurrent } = input;
  const runtime = input.state.runtime;
  const cached = input.refresh
    ? undefined
    : cachedDestinationRole(runtime.infra.execSql, listed);
  // Ordinary parent edges are not immutable. A refresh authenticates current
  // placement; a forged root hint must also be corrected from a signed path.
  if (cached && !(cached.parentId === undefined && listed.parentId === null)) {
    return { freshlyVerified: false, parentId: cached.parentId, role: cached };
  }
  const verified = await verifyDestinationRole({
    heldBinding: input.heldBinding,
    prefetched: input.refresh ? undefined : input.prefetchedProjection,
    isCurrent,
    listed,
    runtime,
    verifyCurrentPlacement: input.refresh === true,
    onVerifiedCheckpoint: input.onVerifiedCheckpoint,
  });
  if (!verified) return null;
  return {
    freshlyVerified: true,
    parentId:
      input.refresh || listed.parentId === null
        ? verified.parentId
        : verified.role.parentId,
    role: verified.role,
  };
}

/**
 * Listing hints never establish a metadata target or a system/root role, and a
 * held folder keeps its organization and metadata target unless its own user
 * re-created it elsewhere. A conflicting proof is refused before placement pins
 * advance or its role is cached.
 */
export async function verifyRemoteContainerDestination(
  input: VerifyRemoteContainerDestinationInput,
): Promise<RemoteContainer | null> {
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
      if (input.supersededListing) {
        throw new KeyingVerificationError(
          "object_mismatch",
          "container was re-homed away from the listed organization",
        );
      }
      // A held ordinary binding was verified (or signed by this device) when
      // it was stored; a listing that repeats it needs no second proof.
      if (
        !input.refresh &&
        listingRepeatsHeldOrdinaryBinding(input.heldBinding, listed)
      ) {
        return { ...listed, systemSlot: null };
      }
      if (input.refresh)
        runtime.apiClient.evictContainerWriterProjection(listed.id);
      // A metadata root read before a reserved-group commit is reloaded once.
      const resolved = await resolveWithMetadataRootReload(
        input,
        resolveDestinationRole,
        () => runtime.apiClient.evictContainerWriterProjection(listed.id),
      ).catch((error: unknown) => {
        // Never re-serve a cached projection that failed verification.
        if (isKeyingVerificationError(error))
          runtime.apiClient.evictContainerWriterProjection(listed.id);
        throw error;
      });
      if (!resolved || isCurrent?.() === false) return null;
      const { role, parentId } = resolved;
      assertPermittedDestinationBinding({
        heldBinding: input.heldBinding,
        listed,
        role,
        runtime,
      });
      if (resolved.freshlyVerified)
        rememberDestinationRole(runtime.infra.execSql, listed, role);
      assertAcknowledgedRootSigner({ listed, role, runtime });
      return {
        ...listed,
        metadataDocumentId: role.metadataDocumentId,
        parentId: parentId === undefined ? listed.parentId : parentId,
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
