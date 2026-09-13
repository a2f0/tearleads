import { KeyingVerificationError } from "@tearleads/crypto";
import { verifyContainerDestinationProjection } from "../../../data/keyingProjectionVerification/containerDestinationVerification";
import { runWithSecurityIncidentReporting } from "../../../data/keyingProjectionVerification/error";
import { createRuntimePrincipalPolicyWarmer } from "../../principals/runtimePolicyWarmer";
import {
  cachedDestinationRole,
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
    ((listed.parentId === null || existing?.parentId === null) &&
      listed.id === input.state.runtime.auth.rootContainerId)
  );
}

/** Listing hints may trigger a fetch, but never establish a system/root role. */
export async function verifyRemoteContainerDestination(input: {
  remoteContainer: RemoteContainer;
  state: RemoteContainerHydrationState;
  isCurrent?: (() => boolean) | undefined;
}): Promise<RemoteContainer | null> {
  const { remoteContainer: listed, state, isCurrent } = input;
  const runtime = state.runtime;
  const cached = cachedDestinationRole(runtime.infra.execSql, listed);
  if (cached) return isCurrent?.() === false ? null : { ...listed, ...cached };
  return runWithSecurityIncidentReporting(
    runtime.util.reportSecurityIncident,
    {
      objectId: listed.id,
      objectKind: "container",
      operation: "container.destination.verify",
      organizationId: listed.organizationId,
    },
    async () => {
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
      const path = await verifyContainerDestinationProjection({
        execSql: runtime.infra.execSql,
        projection,
        resolveUserKey: runtime.resolveTrustedUserIdentity,
        warmReferencedPrincipalPolicies:
          createRuntimePrincipalPolicyWarmer(runtime),
      });
      if (isCurrent?.() === false) return null;
      const head = path.at(-1);
      if (!head || head.state.containerId !== listed.id) {
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
      const role = {
        metadataDocumentId: head.state.metadataDocumentId,
        parentId: head.state.parentContainerId,
        systemSlot: head.state.systemSlot,
      };
      rememberDestinationRole(runtime.infra.execSql, listed, role);
      return { ...listed, ...role };
    },
  );
}
