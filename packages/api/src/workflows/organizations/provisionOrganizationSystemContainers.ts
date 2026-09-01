import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { containerBuiltinGrants } from "@tearleads/api-shared/schema";
import type {
  OrganizationProvisioningRequest,
  ProvisionedSystemContainerRequest,
} from "@tearleads/validators/request";
import type { ContainerCreateWithMetadataDocumentResponse } from "@tearleads/validators/response";
import { createContainer } from "../containers/mutations/createContainer";
import {
  applyContainerSystemSlot,
  readContainerMetadataDocumentId,
} from "../containers/mutations/createContainerWithMetadataDocument";
import { createDocumentWithExecutor } from "../documents/mutations";
import { appendProvisionedDocumentInitialUpdate } from "../documents/mutations/syncDocument";
import { OrganizationProvisioningError } from "./provisionOrganizationError";

interface SystemContainerSigner {
  readonly fingerprint: string;
  readonly signingPublicKey: Uint8Array;
}

/**
 * Records the organization-metadata container's read grant to the reserved
 * Members group as a built-in grant.
 *
 * Like the root -> Admins grant, this is a reserved system grant: Members must
 * never lose it (revoking it permanently strips their ability to decrypt the org
 * display name, with no self-heal — the client metadata re-wrap only refreshes a
 * verified existing grant and refuses to mint, a metadata->Members analog of the
 * root/Admins lockout). Unlike root -> Admins it is not admin-frozen: it must
 * still be re-wrapped on every Members-group key rotation. Recording it here lets
 * the built-in-grant guard reject a revoke / access-level change while still
 * permitting the same-level "read" re-wrap (assertContainerBuiltinGrantPolicyPreserved),
 * and flips the org-manager UI's computed isBuiltin flag so the grant renders as
 * built-in rather than revocable.
 */
async function createOrganizationMetadataBuiltinGrant(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  organizationId: string,
  metadataContainerId: string,
): Promise<void> {
  await tx.insert(containerBuiltinGrants).values({
    accessLevel: "read",
    containerId: metadataContainerId,
    organizationId,
    subjectId: input.initialMemberGroup.groupId,
    subjectType: "group",
  });
}

async function createProvisionedSystemContainer(
  tx: DatabaseTransaction,
  input: {
    request: ProvisionedSystemContainerRequest;
    signer: SystemContainerSigner;
    userId: string;
  },
): Promise<ContainerCreateWithMetadataDocumentResponse> {
  const container = await createContainer({
    executor: tx,
    fingerprint: input.signer.fingerprint,
    request: input.request.container,
    userId: input.userId,
  });
  const metadataDocumentId = readContainerMetadataDocumentId(container);

  const metadataDocument = await createDocumentWithExecutor({
    executor: tx,
    fingerprint: input.signer.fingerprint,
    request: input.request.metadataDocument,
    userId: input.userId,
  });
  if (metadataDocument.id !== metadataDocumentId) {
    throw new OrganizationProvisioningError(
      "Provisioned system container metadata document mismatch",
      400,
    );
  }
  await appendProvisionedDocumentInitialUpdate({
    documentId: metadataDocument.id,
    executor: tx,
    fingerprint: input.signer.fingerprint,
    request: input.request.initialMetadataSync,
    signingPublicKey: input.signer.signingPublicKey,
    userId: input.userId,
  });

  const systemSlot = input.request.systemSlot ?? null;
  const nextContainer = systemSlot
    ? await applyContainerSystemSlot(tx, {
        container,
        slot: systemSlot,
      })
    : container;

  return { container: nextContainer, metadataDocument };
}

export async function createInitialRosterProfileContainer(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: SystemContainerSigner,
): Promise<ContainerCreateWithMetadataDocumentResponse | null> {
  if (!input.initialRosterProfileContainer) {
    return null;
  }
  if (!input.initialRosterProfileDocument) {
    throw new OrganizationProvisioningError(
      "Initial roster profile container requires a roster profile document",
      400,
    );
  }

  return createProvisionedSystemContainer(tx, {
    request: input.initialRosterProfileContainer,
    signer,
    userId: input.userId,
  });
}

export async function createInitialOrganizationMetadataContainer(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: SystemContainerSigner,
): Promise<ContainerCreateWithMetadataDocumentResponse | null> {
  if (!input.initialOrganizationMetadataContainer) {
    return null;
  }
  if (!input.initialOrganizationProfileDocument) {
    throw new OrganizationProvisioningError(
      "Initial organization metadata container requires an organization profile document",
      400,
    );
  }

  const metadataContainer = await createProvisionedSystemContainer(tx, {
    request: input.initialOrganizationMetadataContainer,
    signer,
    userId: input.userId,
  });
  await createOrganizationMetadataBuiltinGrant(
    tx,
    input,
    input.organizationId,
    metadataContainer.container.containerId,
  );
  return metadataContainer;
}

export async function createProvisionedSystemContainers(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: SystemContainerSigner,
): Promise<ContainerCreateWithMetadataDocumentResponse[]> {
  const created: ContainerCreateWithMetadataDocumentResponse[] = [];
  for (const request of input.initialSystemContainers ?? []) {
    const provisioned = await createProvisionedSystemContainer(tx, {
      request,
      signer,
      userId: input.userId,
    });
    created.push(provisioned);
  }
  return created;
}
