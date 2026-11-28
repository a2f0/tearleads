import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type {
  PrincipalPolicyAuthorization,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import {
  documentCreateSeedSyncRequest,
  type OrganizationProvisioningRequest,
  type ProvisionedSystemContainerRequest,
} from "@tearleads/validators/request";
import type { ContainerCreateWithMetadataDocumentResponse } from "@tearleads/validators/response";
import { createContainerOutcome } from "../containers/mutations/createContainer";
import { assertContainerSystemSlot } from "../containers/mutations/createContainerWithMetadataDocument";
import { prelockProvisionedOrganizationScope } from "../containers/mutations/shared/mutationRunner";
import type { ContainerMutationContext } from "../containers/mutations/types";
import {
  createContainerWriterProjectionContext,
  seedVerifiedContainerManifestsInContext,
} from "../containers/writerProjection/context";
import type { ContainerWriterProjectionContext } from "../containers/writerProjection/types";
import { createDocumentWithExecutor } from "../documents/mutations";
import { appendProvisionedDocumentInitialUpdate } from "../documents/mutations/syncDocument";
import { OrganizationProvisioningError } from "./provisionOrganizationError";

interface SystemContainerSigner {
  readonly fingerprint: string;
  readonly signingPublicKey: Uint8Array;
}

export interface ProvisioningVerifiedContext {
  readonly containerMutationContext: ContainerMutationContext;
  readonly verifiedContainerContext: ContainerWriterProjectionContext;
  readonly verifiedPrincipalPolicies: readonly PrincipalPolicyAuthorization[];
}

export async function createProvisioningVerifiedContext(input: {
  readonly groupIds: readonly string[];
  readonly organizationId: string;
  readonly rootManifest: VerifiedContainerAccessManifest;
  readonly tx: DatabaseTransaction;
  readonly verifiedPrincipalPolicies: readonly PrincipalPolicyAuthorization[];
}): Promise<ProvisioningVerifiedContext> {
  const verifiedContainerContext = createContainerWriterProjectionContext(
    input.tx,
    input.verifiedPrincipalPolicies,
  );
  seedVerifiedContainerManifestsInContext(verifiedContainerContext, [
    input.rootManifest,
  ]);
  const containerMutationContext: ContainerMutationContext = {
    executor: input.tx,
    manifestHeadByContainerId: new Map(),
    verifiedLiveContainerOrgs: new Map(),
    verifiedManifestByHash: new Map([
      [input.rootManifest.manifestHash, input.rootManifest],
    ]),
    verifiedPrincipalPolicies: input.verifiedPrincipalPolicies,
    writerProjectionContext: verifiedContainerContext,
  };
  await prelockProvisionedOrganizationScope(containerMutationContext, {
    groupIds: input.groupIds,
    organizationId: input.organizationId,
  });
  return {
    containerMutationContext,
    verifiedContainerContext,
    verifiedPrincipalPolicies: input.verifiedPrincipalPolicies,
  };
}

async function createProvisionedSystemContainer(
  tx: DatabaseTransaction,
  input: {
    provisioningContext?: ProvisioningVerifiedContext | undefined;
    request: ProvisionedSystemContainerRequest;
    signer: SystemContainerSigner;
    userId: string;
  },
): Promise<ContainerCreateWithMetadataDocumentResponse> {
  const {
    metadataDocumentId,
    parentContainerPath,
    response: container,
    verifiedManifest,
  } = await createContainerOutcome({
    context: input.provisioningContext?.containerMutationContext,
    executor: tx,
    fingerprint: input.signer.fingerprint,
    request: input.request.container,
    userId: input.userId,
  });
  assertContainerSystemSlot(container, input.request.systemSlot ?? null);
  if (input.provisioningContext) {
    seedVerifiedContainerManifestsInContext(
      input.provisioningContext.verifiedContainerContext,
      [...(parentContainerPath ?? []), verifiedManifest],
    );
  }

  const {
    created: metadataDocument,
    lockedContainerHeads,
    createdDocumentSeed,
  } = await createDocumentWithExecutor({
    containerTouch: "seed",
    executor: tx,
    fingerprint: input.signer.fingerprint,
    request: input.request.metadataDocument,
    userId: input.userId,
    verifiedContainerContext:
      input.provisioningContext?.verifiedContainerContext,
    verifiedPrincipalPolicies:
      input.provisioningContext?.verifiedPrincipalPolicies,
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
    lockedContainerHeads,
    createdDocumentSeed,
    request: documentCreateSeedSyncRequest(
      input.request.metadataDocument,
      input.request.initialMetadataSync,
    ),
    signingPublicKey: input.signer.signingPublicKey,
    userId: input.userId,
  });

  return { container, metadataDocument };
}

export async function createInitialRosterProfileContainer(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: SystemContainerSigner,
  provisioningContext?: ProvisioningVerifiedContext,
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
    provisioningContext,
    request: input.initialRosterProfileContainer,
    signer,
    userId: input.userId,
  });
}

export async function createInitialOrganizationMetadataContainer(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: SystemContainerSigner,
  provisioningContext?: ProvisioningVerifiedContext,
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
    provisioningContext,
    request: input.initialOrganizationMetadataContainer,
    signer,
    userId: input.userId,
  });
}

export async function createProvisionedSystemContainers(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: SystemContainerSigner,
  provisioningContext?: ProvisioningVerifiedContext,
): Promise<ContainerCreateWithMetadataDocumentResponse[]> {
  const created: ContainerCreateWithMetadataDocumentResponse[] = [];
  for (const request of input.initialSystemContainers ?? []) {
    const provisioned = await createProvisionedSystemContainer(tx, {
      provisioningContext,
      request,
      signer,
      userId: input.userId,
    });
    created.push(provisioned);
  }
  return created;
}
