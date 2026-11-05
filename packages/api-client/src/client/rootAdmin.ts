import {
  getRootIdentityOperation,
  getRootOpsHealthReportOperation,
  getRootOrganizationDataUsageOperation,
  getRootOrganizationOperation,
  liftRootIdentitySuspensionOperation,
  listRootAuditEventsOperation,
  listRootDataUsageReportOperation,
  listRootIdentitiesOperation,
  listRootIdentityOrganizationsOperation,
  listRootOrganizationIdentitiesOperation,
  listRootOrganizationRevenuecatEventsOperation,
  listRootOrganizationsOperation,
  listRootRevenuecatEventsReportOperation,
  type RootAuditEventsQuery,
  type RootIdentitiesQuery,
  type RootOrganizationPageQuery,
  type RootOrganizationsQuery,
  type RootRevenuecatEventsQuery,
  type RootRevenuecatEventsReportQuery,
  suspendRootIdentityOperation,
} from "@tearleads/validators/operation";
import type {
  OrganizationDataUsageResponse,
  RootAuditEventsResponse,
  RootDataUsageReportResponse,
  RootIdentitiesResponse,
  RootIdentityDetailResponse,
  RootIdentityOrganizationsResponse,
  RootIdentitySuspensionResponse,
  RootOpsHealthReportResponse,
  RootOrganizationDetailResponse,
  RootOrganizationIdentitiesResponse,
  RootOrganizationRevenuecatEventsResponse,
  RootOrganizationsResponse,
  RootRevenuecatEventsReportResponse,
} from "@tearleads/validators/response";
import { bindPrototypeMethods } from "../requestInternals";
import type { RequestResult, RequestResultOptions } from "../types";
import type { ApiClientContext } from "./apiClientContext";

/** Root operator reads and identity suspensions. */
export class RootAdminArea {
  constructor(private readonly context: ApiClientContext) {
    bindPrototypeMethods(this, RootAdminArea.prototype);
  }

  getRootOrganizationDataUsageResult(
    organizationId: string,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<OrganizationDataUsageResponse>> {
    return this.context.transport.requestResult(
      getRootOrganizationDataUsageOperation,
      { params: { organizationId } },
      options,
    );
  }

  listRootAuditEventsResult(
    query: RootAuditEventsQuery = {},
    options: RequestResultOptions = {},
  ): Promise<RequestResult<RootAuditEventsResponse>> {
    return this.context.transport.requestResult(
      listRootAuditEventsOperation,
      { params: {}, query },
      options,
    );
  }

  getRootOpsHealthReportResult(
    options: RequestResultOptions = {},
  ): Promise<RequestResult<RootOpsHealthReportResponse>> {
    return this.context.transport.requestResult(
      getRootOpsHealthReportOperation,
      { params: {} },
      options,
    );
  }

  listRootRevenuecatEventsReportResult(
    query: RootRevenuecatEventsReportQuery = {},
    options: RequestResultOptions = {},
  ): Promise<RequestResult<RootRevenuecatEventsReportResponse>> {
    return this.context.transport.requestResult(
      listRootRevenuecatEventsReportOperation,
      { params: {}, query },
      options,
    );
  }

  listRootDataUsageReportResult(
    query: RootOrganizationsQuery = {},
    options: RequestResultOptions = {},
  ): Promise<RequestResult<RootDataUsageReportResponse>> {
    return this.context.transport.requestResult(
      listRootDataUsageReportOperation,
      { params: {}, query },
      options,
    );
  }

  listRootOrganizationsResult(
    query: RootOrganizationsQuery = {},
    options: RequestResultOptions = {},
  ): Promise<RequestResult<RootOrganizationsResponse>> {
    return this.context.transport.requestResult(
      listRootOrganizationsOperation,
      { params: {}, query },
      options,
    );
  }

  getRootOrganizationResult(
    organizationId: string,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<RootOrganizationDetailResponse>> {
    return this.context.transport.requestResult(
      getRootOrganizationOperation,
      { params: { organizationId } },
      options,
    );
  }

  listRootOrganizationIdentitiesResult(
    organizationId: string,
    query: RootOrganizationPageQuery = {},
    options: RequestResultOptions = {},
  ): Promise<RequestResult<RootOrganizationIdentitiesResponse>> {
    return this.context.transport.requestResult(
      listRootOrganizationIdentitiesOperation,
      { params: { organizationId }, query },
      options,
    );
  }

  listRootOrganizationRevenuecatEventsResult(
    organizationId: string,
    query: RootRevenuecatEventsQuery = {},
    options: RequestResultOptions = {},
  ): Promise<RequestResult<RootOrganizationRevenuecatEventsResponse>> {
    return this.context.transport.requestResult(
      listRootOrganizationRevenuecatEventsOperation,
      { params: { organizationId }, query },
      options,
    );
  }

  listRootIdentitiesResult(
    query: RootIdentitiesQuery = {},
    options: RequestResultOptions = {},
  ): Promise<RequestResult<RootIdentitiesResponse>> {
    return this.context.transport.requestResult(
      listRootIdentitiesOperation,
      { params: {}, query },
      options,
    );
  }

  getRootIdentityResult(
    userId: string,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<RootIdentityDetailResponse>> {
    return this.context.transport.requestResult(
      getRootIdentityOperation,
      { params: { userId } },
      options,
    );
  }

  listRootIdentityOrganizationsResult(
    userId: string,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<RootIdentityOrganizationsResponse>> {
    return this.context.transport.requestResult(
      listRootIdentityOrganizationsOperation,
      { params: { userId } },
      options,
    );
  }

  suspendRootIdentityResult(
    userId: string,
  ): Promise<RequestResult<RootIdentitySuspensionResponse>> {
    return this.context.transport.requestResult(suspendRootIdentityOperation, {
      params: { userId },
    });
  }

  liftRootIdentitySuspensionResult(
    userId: string,
  ): Promise<RequestResult<RootIdentitySuspensionResponse>> {
    return this.context.transport.requestResult(
      liftRootIdentitySuspensionOperation,
      {
        params: { userId },
      },
    );
  }
}
