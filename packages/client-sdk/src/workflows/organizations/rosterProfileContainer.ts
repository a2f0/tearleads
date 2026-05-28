import { bytesToBase64 } from "@tearleads/encoding";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";

const CONTAINER_SYSTEM_SLOT_PREFIX = "sys_v1_";

export const ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME = "Roster Profiles";

function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function deriveOrganizationRosterProfileContainerSystemSlot(input: {
  readonly organizationId: string;
}): Promise<ContainerSystemSlot> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify({
        namespace: "tearleads.organization-roster-profiles",
        organizationId: input.organizationId,
        version: 1,
      }),
    ),
  );

  return `${CONTAINER_SYSTEM_SLOT_PREFIX}${toBase64Url(
    new Uint8Array(digest),
  )}`;
}
