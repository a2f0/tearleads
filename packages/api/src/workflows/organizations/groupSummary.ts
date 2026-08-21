import type { OrganizationGroupSummaryResponse } from "@symcrypt/validators/response";

export function toGroupSummary(input: {
  createdAt: Date;
  groupId: string;
  isBuiltin: boolean;
  name: string;
  organizationId: string;
  state:
    | {
        stateHash: string;
        version: number;
        keyEpoch: number;
        keyFingerprint: string;
        memberCount: number;
      }
    | null
    | undefined;
}): OrganizationGroupSummaryResponse {
  return {
    groupId: input.groupId,
    organizationId: input.organizationId,
    name: input.name,
    createdAt: input.createdAt.toISOString(),
    isBuiltin: input.isBuiltin,
    currentState: input.state
      ? {
          stateHash: input.state.stateHash,
          version: input.state.version,
          keyEpoch: input.state.keyEpoch,
          keyFingerprint: input.state.keyFingerprint,
          memberCount: input.state.memberCount,
        }
      : null,
  };
}
