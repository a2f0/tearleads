import {
  KeyingVerificationError,
  verifyOrganizationReplacementAuthorization,
} from "@tearleads/crypto";
import {
  assertHeldContainerBinding,
  type HeldContainerBinding,
} from "../../../data/containers/containerBinding";
import { loadOrganizationFounder } from "../../../data/persistence/organizationFounderPersistence";
import { persistOrganizationReplacementCheckpoints } from "../../../data/persistence/organizationReplacementCheckpointPersistence";
import type { DestinationRole } from "./destinationRoleCache";
import type { RemoteContainer, RemoteContainerHydrationState } from "./types";

export interface BindingInput {
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly heldBinding: HeldContainerBinding | null;
  readonly listed: Pick<RemoteContainer, "id" | "organizationId">;
  readonly role: DestinationRole;
  readonly runtime: RemoteContainerHydrationState["runtime"];
}

async function acceptsSharedReplacement(
  input: BindingInput,
  oldOrganizationId: string,
): Promise<boolean> {
  const { listed, role, runtime } = input;
  const founder = await loadOrganizationFounder(
    runtime.infra.execSql,
    oldOrganizationId,
  );
  if (!founder || role.createSignerUserId !== founder.userId) return false;
  const identity = await runtime.resolveTrustedUserIdentity(founder.userId);
  if (
    !identity ||
    identity.signingKeyFingerprint !== founder.signingKeyFingerprint
  )
    throw new KeyingVerificationError(
      "signer_mismatch",
      "Replacement founder differs from the held organization's pinned identity",
    );
  const response =
    await runtime.apiClient.getContainerReplacementAuthorizations(
      listed.id,
      oldOrganizationId,
    );
  if (!response) return false;
  const last = verifyReplacementLineage(
    response.authorizations,
    oldOrganizationId,
    founder.userId,
    identity.signingPublicKey,
  );
  const replacementFounder = await loadOrganizationFounder(
    runtime.infra.execSql,
    listed.organizationId,
  );
  if (
    last?.organizationId !== listed.organizationId ||
    replacementFounder?.userId !== founder.userId ||
    replacementFounder.signingKeyFingerprint !==
      founder.signingKeyFingerprint ||
    replacementFounder.genesisStateHash !== last.organizationStateHash ||
    role.rootContainerId !== last.rootContainerId ||
    role.rootCreateManifestHash !== last.rootManifestHash ||
    role.rootMetadataDocumentId !== last.rootMetadataDocumentId
  )
    throw new KeyingVerificationError(
      "object_mismatch",
      "Replacement authorization does not bind the destination genesis",
    );
  // The founder also commits the reserved groups' genesis. Pin those even
  // when the readable folder's projection does not cite both groups yet.
  await persistOrganizationReplacementCheckpoints({
    authorization: last,
    execSql: runtime.infra.execSql,
    stillCurrent: input.stillCurrent,
  });
  return true;
}

function verifyReplacementLineage(
  authorizations: readonly unknown[],
  oldOrganizationId: string,
  userId: string,
  signingPublicKey: Uint8Array,
) {
  let expected = oldOrganizationId;
  const visited = new Set([expected]);
  let last:
    | ReturnType<typeof verifyOrganizationReplacementAuthorization>
    | undefined;
  for (const candidate of authorizations) {
    const proof = verifyOrganizationReplacementAuthorization(
      candidate,
      signingPublicKey,
    );
    if (
      proof.replacesOrganizationId !== expected ||
      proof.userId !== userId ||
      visited.has(proof.organizationId)
    )
      throw new KeyingVerificationError(
        "object_mismatch",
        "Replacement authorization lineage does not extend the held organization",
      );
    expected = proof.organizationId;
    visited.add(expected);
    last = proof;
  }
  return last;
}

/** A foreign creator needs the held organization's pinned founder to authorize rehome. */
export async function assertPermittedDestinationBinding(
  input: BindingInput,
): Promise<void> {
  const { heldBinding: held, listed, role, runtime } = input;
  if (role.createSignerUserId === runtime.auth.userId) return;
  if (held?.metadataDocumentId === null)
    throw new KeyingVerificationError(
      "signer_mismatch",
      "a local folder can bind only to its own signed create",
    );
  if (
    held?.organizationId &&
    held.organizationId !== listed.organizationId &&
    role.systemSlot === null &&
    (await acceptsSharedReplacement(input, held.organizationId))
  )
    return;
  assertHeldContainerBinding(held, {
    organizationId: listed.organizationId,
    metadataDocumentIds: [role.metadataDocumentId],
  });
}
