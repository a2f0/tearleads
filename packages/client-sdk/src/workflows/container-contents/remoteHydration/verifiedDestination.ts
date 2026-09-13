import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import {
  verifiedContainerCreateManifest,
  verifyContainerDestinationProjection,
} from "../../../data/keyingProjectionVerification/containerDestinationVerification";
import { runWithSecurityIncidentReporting } from "../../../data/keyingProjectionVerification/error";
import { createRuntimePrincipalPolicyWarmer } from "../../principals/runtimePolicyWarmer";
import {
  cachedDestinationRole,
  type DestinationRole,
  rememberDestinationRole,
} from "./destinationRoleCache";
import type { RemoteContainer, RemoteContainerHydrationState } from "./types";

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

function destinationRoleFromPath(input: {
  listed: RemoteContainer;
  path: readonly VerifiedContainerAccessManifest[];
  verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
}): DestinationRole {
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
  if (head.state.systemSlot !== null && path.length !== 2) {
    throw new KeyingVerificationError(
      "invalid_shape",
      "system destination must be a root child",
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
function assertAcknowledgedRootSigner(input: {
  listed: RemoteContainer;
  role: DestinationRole;
  runtime: RemoteContainerHydrationState["runtime"];
}): void {
  const { listed, role, runtime } = input;
  if (role.parentId !== null || listed.id !== runtime.auth.rootContainerId) {
    return;
  }
  if (role.createSignerUserId !== runtime.auth.userId) {
    throw new KeyingVerificationError(
      "signer_mismatch",
      "acknowledged session root was not created by the session user",
    );
  }
}

async function verifyDestinationRole(input: {
  isCurrent?: (() => boolean) | undefined;
  listed: RemoteContainer;
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
  const { path, verifiedByHash } = await verifyContainerDestinationProjection({
    execSql: runtime.infra.execSql,
    projection,
    resolveUserKey: runtime.resolveTrustedUserIdentity,
    warmReferencedPrincipalPolicies:
      createRuntimePrincipalPolicyWarmer(runtime),
  });
  if (isCurrent?.() === false) return null;
  const role = destinationRoleFromPath({ listed, path, verifiedByHash });
  rememberDestinationRole(runtime.infra.execSql, listed, role);
  return role;
}

/** Listing hints may trigger a fetch, but never establish a system/root role. */
export async function verifyRemoteContainerDestination(input: {
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
      const role =
        cachedDestinationRole(runtime.infra.execSql, listed) ??
        (await verifyDestinationRole({ isCurrent, listed, runtime }));
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
