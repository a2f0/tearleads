import type { OrganizationLeaveRequestMembersHead } from "@tearleads/validators/util";

/** A Members head for leave requests whose membership a test does not check. */
export const TEST_LEAVE_REQUEST_MEMBERS_HEAD: OrganizationLeaveRequestMembersHead =
  {
    keyEpoch: 2,
    keyFingerprint: "members-key-2",
    principalId: "4e5f6a7b-8c9d-4e0f-8a1b-2c3d4e5f6a7b",
    stateHash: "members-state-4",
    version: 4,
  };
