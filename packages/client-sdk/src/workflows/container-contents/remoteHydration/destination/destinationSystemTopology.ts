import { KeyingVerificationError } from "@tearleads/crypto";
import {
  deriveOrganizationMetadataContainerSystemSlot,
  deriveOrganizationTrashSystemSlot,
} from "@tearleads/validators/containerSystemSlot";

/** All fields come from the verified path, including parents absent from the local tree. */
export async function assertSystemDestinationTopology(input: {
  organizationId: string;
  pathLength: number;
  rootSystemSlot: string | null;
  systemSlot: string | null;
}) {
  if (input.systemSlot === null) return;
  const metadataSlot =
    await deriveOrganizationMetadataContainerSystemSlot(input);
  if (
    input.rootSystemSlot !== null &&
    input.systemSlot === deriveOrganizationTrashSystemSlot(input.organizationId)
  ) {
    throw new KeyingVerificationError(
      "invalid_shape",
      "Trash must be a child of the organization's data root",
    );
  }
  if (input.pathLength !== (input.systemSlot === metadataSlot ? 1 : 2)) {
    throw new KeyingVerificationError(
      "invalid_shape",
      "system destination has the wrong signed topology",
    );
  }
}
