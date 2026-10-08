import {
  type CommitOrganizationGroupPolicyRequest,
  CommitOrganizationGroupPolicyRequestSchema,
  type CreateOrganizationGroupWithPolicyRequest,
  CreateOrganizationGroupWithPolicyRequestSchema,
  type DeleteOrganizationGroupRequest,
  DeleteOrganizationGroupRequestSchema,
  type OrganizationPrincipalPolicyRequest,
  OrganizationPrincipalPolicyRequestSchema,
} from "@tearleads/validators/request";
import { isUuidV4String } from "@tearleads/validators/util";

export type AuthoredPrincipalMutation =
  | {
      // Existing signed pending requests have no kind. Keep them in the same
      // scope and recovery lane so an upgrade cannot hide uncertain work.
      readonly kind?: undefined;
      readonly groupId: string;
      readonly request: CommitOrganizationGroupPolicyRequest;
    }
  | {
      readonly kind: "group-create";
      readonly groupId: string;
      readonly request: CreateOrganizationGroupWithPolicyRequest;
    }
  | {
      readonly kind: "group-delete";
      readonly groupId: string;
      readonly request: DeleteOrganizationGroupRequest;
    }
  | {
      readonly kind: "organization";
      readonly groupId: null;
      readonly request: OrganizationPrincipalPolicyRequest;
    };

interface SignerScope {
  readonly organizationId: string;
  readonly userId: string;
  readonly signingFingerprint: string;
}

/** Validate authored inputs; opening an existing row authenticates it first. */
export function readPrincipalMutation(
  value: unknown,
  scope: SignerScope,
): AuthoredPrincipalMutation {
  if (typeof value !== "object" || value === null)
    throw new Error("Principal mutation journal payload is invalid");
  const groupId: unknown = Reflect.get(value, "groupId");
  const kind: unknown = Reflect.get(value, "kind");
  const body: unknown = Reflect.get(value, "request");
  if (kind === "organization") {
    if (groupId !== null)
      throw new Error("Organization journal target differs");
    const request = OrganizationPrincipalPolicyRequestSchema.parse(body);
    assertStateScope(
      request.state,
      "organization",
      scope.organizationId,
      scope,
    );
    return { kind, groupId, request };
  }
  if (typeof groupId !== "string" || !isUuidV4String(groupId))
    throw new Error("Principal mutation journal group target is invalid");
  if (kind === "group-create") {
    const request = CreateOrganizationGroupWithPolicyRequestSchema.parse(body);
    if (request.groupId !== groupId)
      throw new Error("Group creation journal target differs");
    assertStateScope(request.initialGroupPolicy.state, "group", groupId, scope);
    assertStateScope(
      request.organizationPolicy.state,
      "organization",
      scope.organizationId,
      scope,
    );
    return { kind, groupId, request };
  }
  if (kind === "group-delete") {
    const request = DeleteOrganizationGroupRequestSchema.parse(body);
    assertStateScope(
      request.organizationPolicy.state,
      "organization",
      scope.organizationId,
      scope,
    );
    return { kind, groupId, request };
  }
  if (kind !== undefined)
    throw new Error("Principal mutation journal operation is unsupported");
  const request = CommitOrganizationGroupPolicyRequestSchema.parse(body);
  assertStateScope(request.groupPolicy.state, "group", groupId, scope);
  assertStateScope(
    request.organizationPolicy.state,
    "organization",
    scope.organizationId,
    scope,
  );
  return { groupId, request };
}

function assertStateScope(
  state: OrganizationPrincipalPolicyRequest["state"],
  principalType: "organization" | "group",
  principalId: string,
  scope: SignerScope,
) {
  if (
    state.principalType !== principalType ||
    state.principalId !== principalId ||
    state.signerUserId !== scope.userId ||
    state.signerUserKeyFingerprint !== scope.signingFingerprint
  )
    throw new Error("Principal mutation journal target or signer differs");
}
