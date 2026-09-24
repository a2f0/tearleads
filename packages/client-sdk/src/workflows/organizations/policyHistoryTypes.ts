import type {
  PrincipalContainerGrantResponse,
  PrincipalProjectionMemberResponse,
  PrincipalStateResponse,
} from "@tearleads/validators/response";

export type OrganizationPrincipalMemberChangeType =
  | "added"
  | "removed"
  | "role_changed";
export interface OrganizationPrincipalMemberChange {
  readonly changeType: OrganizationPrincipalMemberChangeType;
  readonly userId: string;
  readonly nextRole: PrincipalProjectionMemberResponse["role"] | null;
  readonly previousRole: PrincipalProjectionMemberResponse["role"] | null;
}
export interface OrganizationPrincipalPolicyHistoryEntry {
  readonly changes: OrganizationPrincipalMemberChange[];
  readonly createdAt: string;
  readonly keyEpoch: number;
  readonly memberCount: number;
  readonly signedAt: string;
  readonly signerUserId: string;
  readonly signerUserKeyFingerprint: string;
  readonly stateHash: string;
  readonly version: number;
}
export type OrganizationGroupPolicyHistoryEntry =
  OrganizationPrincipalPolicyHistoryEntry;
export interface OrganizationPrincipalPolicyHistory {
  readonly entries: OrganizationPrincipalPolicyHistoryEntry[];
  readonly principalId: string;
  readonly principalType: PrincipalStateResponse["principalType"];
}
export interface OrganizationGroupPolicyHistory
  extends OrganizationPrincipalPolicyHistory {
  readonly groupId: string;
  readonly organizationId: string;
  readonly principalType: "group";
}
export interface OrganizationPolicyHistory
  extends OrganizationPrincipalPolicyHistory {
  readonly entries: OrganizationPolicyHistoryEntry[];
  readonly organizationId: string;
  readonly principalType: "organization";
}

export interface OrganizationPolicyHistoryEntry
  extends OrganizationPrincipalPolicyHistoryEntry {
  /** Null when the additional signed evidence has not been loaded. */
  readonly groupChanges: OrganizationPolicyGroupChange[] | null;
}

export interface OrganizationPolicyGrantChange {
  readonly containerId: string;
  readonly previousAccess:
    | PrincipalContainerGrantResponse["accessLevel"]
    | null;
  readonly nextAccess: PrincipalContainerGrantResponse["accessLevel"] | null;
}

export interface OrganizationPolicyGroupChange {
  readonly groupId: string;
  readonly changeType: "created" | "updated" | "deleted";
  readonly previousVersion: number | null;
  readonly version: number;
  readonly previousKeyEpoch: number | null;
  readonly keyEpoch: number;
  readonly changes: OrganizationPrincipalMemberChange[];
  readonly grantChanges: OrganizationPolicyGrantChange[];
}
