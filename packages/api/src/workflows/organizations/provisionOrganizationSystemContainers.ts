import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
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
): Promise<ContainerCreateWithMetadataDocumentResponse> {
  const metadataSlot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId: input.organizationId,
  });
  if (input.initialOrganizationMetadataContainer.systemSlot !== metadataSlot) {
    throw new OrganizationProvisioningError(
      "Initial organization metadata container has the wrong system slot",
      400,
    );
  }
  // Both metadata-root grants are built-in by derivation from the slot and the
  // reserved groups: grant guards reject their removal or access-level change
  // and permit re-wraps on key rotation.
  return createProvisionedSystemContainer(tx, {
    request: input.initialOrganizationMetadataContainer,
    signer,
    userId: input.userId,
  });
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
