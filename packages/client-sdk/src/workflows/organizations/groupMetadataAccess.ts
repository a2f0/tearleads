import {
  type ContainerAccessManifestState,
  decryptGroupMetadata,
  type GroupMetadataKey,
  readGroupMetadata,
} from "@tearleads/crypto";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  getTargetContainerContext,
  readContainerState,
} from "../../data/containers/shared/projection";
import { unwrapContainerKekPath } from "../../data/documents/shared/containerKekPath";
import type {
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../data/keyingProjectionVerification";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { loadContainers } from "../../data/persistence/containers/containerPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { MetadataRootBehindDirectoryError } from "./groupMetadataErrors";
import type { GroupPolicyNameReader } from "./principalPolicyRequest";

export interface GroupMetadataAccessInput {
  readonly apiClient: {
    /** Drops a cached root so a superseded one can be refetched. */
    evictContainerWriterProjection?(containerId: string): void;
    getContainerWriterProjection(
      containerId: string,
    ): Promise<ContainerWriterProjectionResponse | null>;
  };
  readonly verifyMetadataContainer: (
    state: ContainerAccessManifestState,
  ) => Promise<void>;
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
  readonly targetSecretKey: Uint8Array;
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}

/**
 * A root read before a reserved-group commit the directory already reflects
 * is reloaded once; a root still behind after that stays a plain miss.
 */
async function loadMetadataKeyring(
  input: GroupMetadataAccessInput,
  containerId: string,
) {
  try {
    return await loadMetadataKeyringOnce(input, containerId);
  } catch (error) {
    if (!(error instanceof MetadataRootBehindDirectoryError)) throw error;
    input.apiClient.evictContainerWriterProjection?.(containerId);
    return loadMetadataKeyringOnce(input, containerId);
  }
}

async function loadMetadataKeyringOnce(
  input: GroupMetadataAccessInput,
  containerId: string,
) {
  const projection =
    await input.apiClient.getContainerWriterProjection(containerId);
  if (!projection) return null;
  if (
    projection.containerId !== containerId ||
    projection.organizationId !== input.organizationId
  )
    throw new Error("Group metadata container is unavailable");
  const target = getTargetContainerContext(projection);
  const state = readContainerState(target.manifest);
  const slot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId: input.organizationId,
  });
  if (
    state.organizationId !== input.organizationId ||
    state.systemSlot !== slot ||
    state.parentContainerId !== null
  )
    throw new Error(
      "Group metadata requires the signed organization metadata container",
    );
  await input.verifyMetadataContainer(state);
  assertProjectionVerificationCurrent(input.stillCurrent);
  const keys = await unwrapContainerKekPath({
    ...input,
    projection,
    secretKey: input.targetSecretKey,
  });
  assertProjectionVerificationCurrent(input.stillCurrent);
  const keyMaterial = keys.get(target.kek.containerKeyEpochId);
  if (!keyMaterial)
    throw new Error("Group metadata container key is unavailable");
  return {
    current: {
      organizationId: input.organizationId,
      containerId,
      containerKeyEpochId: target.kek.containerKeyEpochId,
      keyMaterial,
    },
    keys,
  };
}

/** Uses the shared metadata container's authenticated keyring, including old epochs. */
export function createGroupMetadataAccess(input: GroupMetadataAccessInput) {
  const loads = new Map<
    string,
    Promise<{
      current: GroupMetadataKey;
      keys: ReadonlyMap<string, Uint8Array>;
    } | null>
  >();
  function loaded(containerId: string) {
    let pending = loads.get(containerId);
    if (!pending) {
      pending = loadMetadataKeyring(input, containerId);
      loads.set(containerId, pending);
    }
    return pending;
  }
  const readName: GroupPolicyNameReader = async (bundle) => {
    assertProjectionVerificationCurrent(input.stillCurrent);
    const metadata = readGroupMetadata(bundle.currentPayload.ciphertext);
    if ("role" in metadata)
      return metadata.role === "admins" ? "Admins" : "Members";
    if (
      metadata.organizationId !== input.organizationId ||
      metadata.groupId !== bundle.currentState.principalId ||
      bundle.currentState.principalType !== "group"
    )
      throw new Error("Group metadata scope does not match its signed group");
    const keyring = await loaded(metadata.containerId);
    const keyMaterial = keyring?.keys.get(metadata.containerKeyEpochId);
    if (!keyMaterial)
      throw new Error("Group metadata historical key is unavailable");
    return decryptGroupMetadata({
      key: { ...metadata, keyMaterial },
      groupId: bundle.currentState.principalId,
      payload: bundle.currentPayload.ciphertext,
    });
  };
  return {
    readName,
    async loadEncryptionKey(): Promise<GroupMetadataKey> {
      const slot = await deriveOrganizationMetadataContainerSystemSlot({
        organizationId: input.organizationId,
      });
      const containers = await loadContainers(input.execSql);
      const container = containers.find(
        (row) =>
          row.organizationId === input.organizationId &&
          row.systemSlot === slot,
      );
      if (!container)
        throw new Error(
          "Organization metadata container has not been discovered",
        );
      const keyring = await loaded(container.id);
      if (!keyring) throw new Error("Group metadata container is unavailable");
      return keyring.current;
    },
  };
}
