import {
  getContainerKekLogOperation,
  getContainerReplacementAuthorizationsOperation,
  listContainerDocumentLanesOperation,
  listContainerParentLanesOperation,
} from "@tearleads/validators/operation";
import type {
  ListContainerDocumentLanesRequest,
  ListContainerParentLanesRequest,
} from "@tearleads/validators/request";
import type {
  ListContainerDocumentLanesResponse,
  ListContainerParentLanesResponse,
} from "@tearleads/validators/response";
import {
  bindPrototypeMethods,
  dedupedRequest,
  listContainerDocumentLanesRequestKey,
  listContainerParentLanesRequestKey,
} from "../requestInternals";
import {
  type ContainerKekLogOptions,
  containerDocumentLanes,
  containerKekLog,
  containerParentLanes,
} from "../routes/containers/reads";
import type { RequestResultOptions } from "../types";
import { type ApiClientContext, dataOrNull } from "./apiClientContext";
import { laneListingRequest } from "./laneListingRequest";

/** Container rotation logs, replacement authorizations, and lane listings. */
export class ContainerReadArea {
  constructor(private readonly context: ApiClientContext) {
    bindPrototypeMethods(this, ContainerReadArea.prototype);
  }

  getContainerReplacementAuthorizationsResult(
    containerId: string,
    replacesOrganizationId: string,
  ) {
    return this.context.transport.requestResult(
      getContainerReplacementAuthorizationsOperation,
      { params: { containerId, replacesOrganizationId } },
      { reportErrors: false },
    );
  }

  /**
   * The append-only rotation log for one container — the rebuild/repair
   * read path. Never cached: it is fetched exactly when the served keyring
   * failed verification and the ground truth is needed. A historical keyring
   * is O(its epoch) bytes, so at most one ships per request, named by
   * `keyringForEpoch`.
   */
  getContainerKekLog(
    containerId: string,
    options: ContainerKekLogOptions = {},
  ) {
    return this.context.send(
      containerKekLog,
      containerKekLog.path(containerId, options),
      getContainerKekLogOperation,
    );
  }

  listContainerParentLanes(input: ListContainerParentLanesRequest) {
    return dedupedRequest(
      this.context.containerParentLaneRequestsByKey,
      listContainerParentLanesRequestKey(input),
      async () =>
        dataOrNull(
          await laneListingRequest(this.context, {
            body: JSON.stringify(input),
            method: containerParentLanes.method,
            operation: listContainerParentLanesOperation,
            path: containerParentLanes.path,
            reportErrors: true,
            validator: (value): value is ListContainerParentLanesResponse =>
              containerParentLanes.isResponseForRequest(input, value),
          }),
        ),
    );
  }

  /** Batched document listing; see `containerDocumentLanes.settle`. */
  async listContainerDocumentLanes(
    input: ListContainerDocumentLanesRequest,
    options: Pick<RequestResultOptions, "reportErrors"> = {},
  ): Promise<ListContainerDocumentLanesResponse | null> {
    return containerDocumentLanes.settle(
      await dedupedRequest(
        this.context.containerDocumentLaneRequestsByKey,
        listContainerDocumentLanesRequestKey(input),
        () =>
          laneListingRequest(this.context, {
            body: JSON.stringify(input),
            method: containerDocumentLanes.method,
            operation: listContainerDocumentLanesOperation,
            path: containerDocumentLanes.path,
            reportErrors: false,
            validator: (value): value is ListContainerDocumentLanesResponse =>
              containerDocumentLanes.isResponseForRequest(input, value),
          }),
      ),
      options.reportErrors ?? true,
      (message) => this.context.runtime.reportError(message),
    );
  }
}
