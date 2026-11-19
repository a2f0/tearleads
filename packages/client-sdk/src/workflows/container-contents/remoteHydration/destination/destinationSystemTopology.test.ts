import { expect, test } from "bun:test";
import {
  deriveOrganizationMetadataContainerSystemSlot,
  deriveOrganizationTrashSystemSlot,
} from "@tearleads/validators/containerSystemSlot";
import { assertSystemDestinationTopology } from "./destinationSystemTopology";

test("a signed Trash destination must be a child of the data root", async () => {
  const organizationId = "shared-org";
  const trash = {
    organizationId,
    pathLength: 2,
    systemSlot: deriveOrganizationTrashSystemSlot(organizationId),
  };
  await expect(
    assertSystemDestinationTopology({ ...trash, rootSystemSlot: null }),
  ).resolves.toBeUndefined();
  const metadataSlot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId,
  });
  await expect(
    assertSystemDestinationTopology({ ...trash, rootSystemSlot: metadataSlot }),
  ).rejects.toMatchObject({ code: "invalid_shape" });
});
