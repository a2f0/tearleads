import { createTestUser } from "@tearleads/test-utils";
import { getDefaultOrganizationId } from "./organizationMembership";
import { registerUser } from "./registerUser";

export async function createBlobStageOwner() {
  const owner = createTestUser();
  await registerUser(owner);
  return {
    owner,
    userId: owner.userId,
    organizationId: await getDefaultOrganizationId(owner.userId),
  };
}
