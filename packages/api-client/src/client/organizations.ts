import {
  createOrganizationOperation,
  getOrganizationDataUsageOperation,
  getOrganizationReadModelOperation,
  listOrganizationGroupMembersOperation,
  listOrganizationMembershipsOperation,
  requestOrganizationLeaveOperation,
  updateOrganizationMembershipOperation,
  updateOrganizationProfileOperation,
  updateOrganizationRosterEntryOperation,
  withdrawOrganizationLeaveRequestOperation,
} from "@tearleads/validators/operation";
import type {
  CreateOrganizationRequest,
  UpdateOrganizationMembershipRequest,
  UpdateOrganizationProfileRequest,
  UpdateOrganizationRosterEntryRequest,
} from "@tearleads/validators/request";
import type {
  OrganizationDataUsageResponse,
  OrganizationMembershipResponse,
  OrganizationReadModelResponse,
} from "@tearleads/validators/response";
import type { OrganizationLeaveRequest } from "@tearleads/validators/util";
import { bindPrototypeMethods } from "../requestInternals";
import { getOrganizationDataUsage as organizationDataUsage } from "../routes/organizations/dataUsage";
import { listOrganizationGroupMembers as groupMembers } from "../routes/organizations/groupMembers";
import {
  withdrawOrganizationLeaveRequest as leaveRequestDelete,
  requestOrganizationLeave as leaveRequestPut,
  listOrganizationMemberships as membershipsList,
  updateOrganizationMembership as membershipUpdate,
} from "../routes/organizations/memberships";
import { updateOrganizationProfile as profileUpdate } from "../routes/organizations/profile";
import { updateOrganizationRosterEntry as rosterUpdate } from "../routes/organizations/roster";
import type { RequestResult, RequestResultOptions } from "../types";
import type { ApiClientContext } from "./apiClientContext";

/** Organization creation, read model, roster, profile, and memberships. */
export class OrganizationArea {
  constructor(private readonly context: ApiClientContext) {
    bindPrototypeMethods(this, OrganizationArea.prototype);
  }

  createOrganization(request: CreateOrganizationRequest) {
    return this.context.transport.request(createOrganizationOperation, {
      body: request,
      params: {},
    });
  }

  getOrganizationReadModelResult(
    organizationId: string,
    cursor?: string,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<OrganizationReadModelResponse>> {
    return this.context.transport.requestResult(
      getOrganizationReadModelOperation,
      {
        params: { organizationId },
        query: { cursor },
      },
      options,
    );
  }

  getOrganizationDataUsageResult(
    organizationId: string,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<OrganizationDataUsageResponse>> {
    return this.context.sendResult(
      organizationDataUsage,
      organizationDataUsage.path(organizationId),
      getOrganizationDataUsageOperation,
      undefined,
      options,
    );
  }

  updateOrganizationRosterEntry(
    organizationId: string,
    userId: string,
    input: UpdateOrganizationRosterEntryRequest,
  ) {
    return this.context.send(
      rosterUpdate,
      rosterUpdate.path(organizationId, userId),
      updateOrganizationRosterEntryOperation,
      input,
      { expectedPaymentRequiredOrganizationId: organizationId },
    );
  }

  /** The session user's own organization memberships; no role required. */
  listOrganizationMemberships() {
    return this.context.send(
      membershipsList,
      membershipsList.path,
      listOrganizationMembershipsOperation,
    );
  }

  updateOrganizationMembership(
    organizationId: string,
    input: UpdateOrganizationMembershipRequest,
  ): Promise<RequestResult<OrganizationMembershipResponse>> {
    return this.context.sendResult(
      membershipUpdate,
      membershipUpdate.path(organizationId),
      updateOrganizationMembershipOperation,
      input,
      { reportErrors: false },
    );
  }

  /** Files the user's signed request to leave, or withdraws it (null). */
  setOrganizationLeaveRequest(
    organizationId: string,
    request: OrganizationLeaveRequest | null,
  ): Promise<RequestResult<OrganizationMembershipResponse>> {
    return request
      ? this.context.sendResult(
          leaveRequestPut,
          leaveRequestPut.path(organizationId),
          requestOrganizationLeaveOperation,
          request,
          { reportErrors: false },
        )
      : this.context.sendResult(
          leaveRequestDelete,
          leaveRequestDelete.path(organizationId),
          withdrawOrganizationLeaveRequestOperation,
          undefined,
          { reportErrors: false },
        );
  }

  updateOrganizationProfile(
    organizationId: string,
    input: UpdateOrganizationProfileRequest,
  ) {
    return this.context.send(
      profileUpdate,
      profileUpdate.path(organizationId),
      updateOrganizationProfileOperation,
      input,
      { expectedPaymentRequiredOrganizationId: organizationId },
    );
  }

  listOrganizationGroupMembers(organizationId: string, groupId: string) {
    return this.context.send(
      groupMembers,
      groupMembers.path(organizationId, groupId),
      listOrganizationGroupMembersOperation,
    );
  }
}
