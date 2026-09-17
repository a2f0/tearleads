import {
  buildRootContainerCreatePlan,
  rootContainerWriterProjectionFromCreatePlan,
} from "@tearleads/client-sdk";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { CreateOrganizationGroupRequest } from "@tearleads/validators/request";

export async function createRegistrationMetadataRoot(input: {
  adminGroup?: CreateOrganizationGroupRequest | undefined;
  memberGroup?: CreateOrganizationGroupRequest | undefined;
  organizationMetadataContainerId?: string | undefined;
  organizationId: string;
  signingPrivateKey: Uint8Array;
  signerKeyFingerprint: string;
  signerDeviceId: string;
  userId: string;
  encapsulationPublicKey: Uint8Array;
}) {
  if (!input.adminGroup || !input.memberGroup)
    throw new Error("Metadata root requires both reserved groups");
  const containerId =
    input.organizationMetadataContainerId ?? crypto.randomUUID();
  const materialized = await buildRootContainerCreatePlan({
    adminGroup: input.adminGroup,
    memberGroup: input.memberGroup,
    author: {
      organizationId: input.organizationId,
      signerUserId: input.userId,
      signerDeviceId: input.signerDeviceId,
      signerKeyFingerprint: input.signerKeyFingerprint,
      signerPrivateKey: input.signingPrivateKey,
    },
    containerId,
    metadataDocumentId: containerId,
    recipientEncapsulationPublicKey: input.encapsulationPublicKey,
    systemSlot: await deriveOrganizationMetadataContainerSystemSlot({
      organizationId: input.organizationId,
    }),
  });
  return {
    containerKey: materialized.containerKey,
    metadataDocumentId: containerId,
    request: materialized.plan.request,
    projection: rootContainerWriterProjectionFromCreatePlan(materialized.plan),
  };
}
