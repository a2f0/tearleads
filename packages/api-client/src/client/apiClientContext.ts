import type { HttpOperation } from "@tearleads/validators/operation";
import type {
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
  ListContainerDocumentLanesResponse,
  ListContainerParentLanesResponse,
  ListDocumentAttachmentsResponse,
  PrincipalPolicyBundleResponse,
  UserIdentityResponse,
} from "@tearleads/validators/response";
import { BoundedCache } from "../ApiCache";
import type { ApiRequestInstrumentation } from "../apiRequestMetrics";
import { ApiRequestRuntime } from "../apiRequestRuntime";
import {
  createOperationTransport,
  type OperationTransport,
} from "../operationTransportFactory";
import { bindPrototypeMethods } from "../requestInternals";
import { DocumentAttributionRequests } from "../routes/documents/attributionRequests";
import type {
  HttpMethod,
  OperationRequestFn,
  OperationRequestResultFn,
  RequestResult,
  RequestResultOptions,
} from "../types";
import type { VerifiedManifestCitations } from "../verifiedManifestCitations";
import {
  CitingProjectionCache,
  evictWriterProjectionsCiting,
} from "../writerProjectionCitations";
import { writerProjectionRequests } from "../writerProjectionRequests";

// A joinable in-flight writer-projection result fetch, pinned to the value
// slot and per-key invalidation stamp it started against. A caller may join
// it only while both are unchanged — see writerProjectionResult.
export interface InFlightWriterProjectionResult<T> {
  readonly invalidationStamp: number;
  readonly resultPromise: Promise<RequestResult<T>>;
  readonly slot: Promise<T | null> | undefined;
}

/** A route's response guard and method; the caller supplies its path. */
interface JsonRoute<T> {
  readonly isResponse: (value: unknown) => value is T;
  readonly method: HttpMethod;
}

/** A status-bearing result collapsed to the plain methods' data-or-null. */
export const dataOrNull = <T>(result: RequestResult<T>): T | null =>
  result.ok ? result.data : null;

const jsonBody = (body: unknown) =>
  body === undefined ? undefined : JSON.stringify(body);

/**
 * The request plumbing and response caches every client area shares: one
 * runtime and transport, the citing projection request functions, and every
 * cache an auth change or a mutation invalidates.
 */
export class ApiClientContext {
  readonly runtime: ApiRequestRuntime;
  readonly transport: OperationTransport;
  readonly request: OperationRequestFn;
  readonly requestResult: OperationRequestResultFn;
  verifiedManifestCitations: VerifiedManifestCitations | null = null;
  readonly containerDocumentLaneRequestsByKey = new Map<
    string,
    Promise<RequestResult<ListContainerDocumentLanesResponse>>
  >();
  readonly containerParentLaneRequestsByKey = new Map<
    string,
    Promise<ListContainerParentLanesResponse | null>
  >();
  readonly containerWriterProjectionRequestsByContainerId =
    new CitingProjectionCache<ContainerWriterProjectionResponse>();
  readonly documentWriterProjectionRequestsByDocumentId =
    new CitingProjectionCache<DocumentWriterProjectionResponse>();
  readonly containerWriterProjectionResultsInFlightByContainerId = new Map<
    string,
    InFlightWriterProjectionResult<ContainerWriterProjectionResponse>
  >();
  readonly documentWriterProjectionResultsInFlightByDocumentId = new Map<
    string,
    InFlightWriterProjectionResult<DocumentWriterProjectionResponse>
  >();
  readonly documentAttachmentListRequestsByDocumentId = new BoundedCache<
    Promise<ListDocumentAttachmentsResponse | null>
  >();
  readonly documentAttributionRequests: DocumentAttributionRequests;
  readonly userIdentityRequestsByUserId = new BoundedCache<
    Promise<UserIdentityResponse | null>
  >();
  readonly principalPolicyRequestsByKey = new BoundedCache<
    Promise<PrincipalPolicyBundleResponse | null>
  >();

  constructor(
    baseUrl?: string | null,
    instrumentation?: ApiRequestInstrumentation,
  ) {
    bindPrototypeMethods(this, ApiClientContext.prototype);
    this.runtime = new ApiRequestRuntime(baseUrl, instrumentation);
    const projectionRequests = writerProjectionRequests(
      this.runtime,
      () => this.verifiedManifestCitations,
    );
    this.request = projectionRequests.request;
    this.requestResult = projectionRequests.requestResult;
    this.transport = createOperationTransport(this.runtime.responseRequest);
    this.documentAttributionRequests = new DocumentAttributionRequests(
      this.transport,
    );
  }

  /** One route call; a defined `body` is sent as JSON. */
  send<T>(
    route: JsonRoute<T>,
    path: string,
    operation: HttpOperation,
    body?: unknown,
    options?: RequestResultOptions,
  ): Promise<T | null> {
    const { isResponse, method } = route;
    return this.request(
      path,
      isResponse,
      method,
      jsonBody(body),
      options,
      operation,
    );
  }

  /** Status-bearing {@link send}. */
  sendResult<T>(
    route: JsonRoute<T>,
    path: string,
    operation: HttpOperation,
    body?: unknown,
    options?: RequestResultOptions,
  ): Promise<RequestResult<T>> {
    const { isResponse, method } = route;
    return this.requestResult(
      path,
      isResponse,
      method,
      jsonBody(body),
      options,
      operation,
    );
  }

  clearAuthScopedCaches(): void {
    this.containerDocumentLaneRequestsByKey.clear();
    this.containerParentLaneRequestsByKey.clear();
    this.documentAttachmentListRequestsByDocumentId.clear();
    this.documentAttributionRequests.clear();
    this.containerWriterProjectionRequestsByContainerId.clear();
    this.documentWriterProjectionRequestsByDocumentId.clear();
    this.containerWriterProjectionResultsInFlightByContainerId.clear();
    this.documentWriterProjectionResultsInFlightByDocumentId.clear();
    this.userIdentityRequestsByUserId.clear();
    this.principalPolicyRequestsByKey.clear();
  }

  invalidateDocumentAttribution(documentId: string): void {
    this.documentAttributionRequests.invalidate(documentId);
  }

  clearWriterProjectionCaches(): void {
    this.documentAttachmentListRequestsByDocumentId.clear();
    this.containerWriterProjectionRequestsByContainerId.clear();
    this.documentWriterProjectionRequestsByDocumentId.clear();
    this.containerWriterProjectionResultsInFlightByContainerId.clear();
    this.documentWriterProjectionResultsInFlightByDocumentId.clear();
  }

  /** After a peer changed these containers' manifests; see the helper. */
  evictWriterProjectionsCiting(containerIds: readonly string[]): void {
    evictWriterProjectionsCiting(new Set(containerIds), {
      attachmentLists: this.documentAttachmentListRequestsByDocumentId,
      containers: {
        cache: this.containerWriterProjectionRequestsByContainerId,
        inFlight: this.containerWriterProjectionResultsInFlightByContainerId,
      },
      documents: {
        cache: this.documentWriterProjectionRequestsByDocumentId,
        inFlight: this.documentWriterProjectionResultsInFlightByDocumentId,
      },
    });
  }

  /**
   * Evict a document's projection and attachment envelopes together: link/unlink
   * changes both. A stale attachment list would regenerate an already committed
   * destination wrap during a move. Unrelated documents keep their caches.
   */
  evictDocumentWriterProjection(documentId: string): void {
    this.documentAttachmentListRequestsByDocumentId.delete(documentId);
    this.documentWriterProjectionRequestsByDocumentId.delete(documentId);
    this.documentWriterProjectionResultsInFlightByDocumentId.delete(documentId);
  }

  /**
   * Container counterpart of {@link evictDocumentWriterProjection}: evict a
   * single container's cached writer projection. A stale-projection create
   * retry only implicates the container it is creating under, so it evicts just
   * that entry rather than clearing the whole projection cache.
   */
  evictContainerWriterProjection(containerId: string): void {
    this.containerWriterProjectionRequestsByContainerId.delete(containerId);
    this.containerWriterProjectionResultsInFlightByContainerId.delete(
      containerId,
    );
  }
}
