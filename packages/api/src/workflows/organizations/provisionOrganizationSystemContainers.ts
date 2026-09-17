import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { containerBuiltinGrants } from "@tearleads/api-shared/schema";
import type {
  OrganizationProvisioningRequest,
  ProvisionedSystemContainerRequest,
} from "@tearleads/validators/request";
import type { ContainerCreateWithMetadataDocumentResponse } from "@tearleads/validators/response";
import { createContainer } from "../containers/mutations/createContainer";
import {
  assertContainerSystemSlot,
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
 * Reserve both metadata-root grants: Admins manage the root and every Members
 * recipient can decrypt organization and group labels. Grant guards reject
 * removal or access-level changes, while permitting re-wraps on key rotation.
 * The local grant projection also uses these rows to mark the grants built-in.
 */
async function createOrganizationMetadataBuiltinGrants(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  organizationId: string,
  metadataContainerId: string,
): Promise<void> {
  await tx.insert(containerBuiltinGrants).values([
    {
      accessLevel: "admin",
      containerId: metadataContainerId,
      organizationId,
      subjectId: input.initialAdminGroup.groupId,
      subjectType: "group",
    },
    {
      accessLevel: "read",
      containerId: metadataContainerId,
      organizationId,
      subjectId: input.initialMemberGroup.groupId,
      subjectType: "group",
    },
  ]);
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
  assertContainerSystemSlot(container, input.request.systemSlot ?? null);
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

  return { container, metadataDocument };
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
  await createOrganizationMetadataBuiltinGrants(
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
