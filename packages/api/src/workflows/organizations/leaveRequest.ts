import {
  isOrganizationLeaveRequest,
  type OrganizationLeaveRequest,
} from "@tearleads/validators/util";

/** The stored leave request, which was verified when the member filed it. */
export function readStoredLeaveRequest(
  stored: string | null,
): OrganizationLeaveRequest | null {
  if (stored === null) return null;
  const parsed: unknown = JSON.parse(stored);
  if (!isOrganizationLeaveRequest(parsed)) {
    throw new Error("Stored organization leave request is malformed");
  }
  return parsed;
}
