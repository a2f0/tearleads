import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { ContainerCreateAccessEventBody } from "./containerAccessTypes";
import { throwVerification } from "./shared";

/** Only organization metadata has an independent root; other slots stay children. */
export async function assertContainerSystemTopology(
  body: ContainerCreateAccessEventBody,
  organizationId: string,
): Promise<void> {
  if (body.systemSlot === null) return;
  const metadataSlot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId,
  });
  if (body.systemSlot === metadataSlot) {
    if (body.parentContainerId !== null)
      throwVerification(
        "invalid_shape",
        "organization metadata must be an independent root",
      );
  } else if (body.parentContainerId === null) {
    throwVerification(
      "invalid_shape",
      "root containers cannot have a system slot",
    );
  }
}
