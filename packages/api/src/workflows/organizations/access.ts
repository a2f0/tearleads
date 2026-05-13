import type { OrganizationRole } from "@tearleads/validators/response";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "../../access/read/principalStateStore";
import type { DatabaseSession } from "../../adapters/postgres";
import { OrganizationManagerError } from "./errors";

interface OrganizationAccess {
  role: OrganizationRole;
}

async function loadDirectOrganizationAccess(input: {
  executor: DatabaseSession;
  organizationId: string;
  userId: string;
}): Promise<OrganizationAccess | null> {
  const state = await getCurrentPrincipalState(
    "organization",
    input.organizationId,
    input.executor,
  );

  if (!state) {
    throw new OrganizationManagerError("Organization policy not found", 404);
  }

  const projection = await listCurrentPrincipalProjectionMembers(
    "organization",
    input.organizationId,
    input.executor,
  );
  const member = projection.find(
    (entry) =>
      entry.memberPrincipalType === "user" &&
      entry.memberPrincipalId === input.userId,
  );

  return member ? { role: member.role } : null;
}

export async function requireDirectOrganizationAccess(input: {
  executor: DatabaseSession;
  organizationId: string;
  requireAdmin?: boolean;
  userId: string;
}): Promise<OrganizationAccess> {
  const access = await loadDirectOrganizationAccess(input);

  if (!access) {
    throw new OrganizationManagerError("Organization access denied", 403);
  }

  if (input.requireAdmin && access.role !== "admin") {
    throw new OrganizationManagerError("Organization admin required", 403);
  }

  return access;
}
