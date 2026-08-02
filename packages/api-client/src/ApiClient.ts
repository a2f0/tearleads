import { authChallengeSigningBytes, sign } from "@tearleads/crypto";
import type { NativeSubscriptionStore } from "@tearleads/validators/billing";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
  CompleteMultipartBlobStageRequest,
  ContainerCreateWithMetadataDocumentRequest,
  ContainerMutationRequest,
  CreateOrganizationGroupRequest,
  CreateOrganizationRequest,
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
  DocumentSyncRequest,
  InitiateMultipartBlobStageRequest,
  ListContainerParentLanesRequest,
  PutPrincipalPolicyRequest,
  RegistrationRequest,
  UpdateOrganizationProfileRequest,
  UpdateOrganizationRosterEntryRequest,
} from "@tearleads/validators/request";
import {
  type BlobAttachmentBindResponse,
  type BlobAttachmentDetachResponse,
  type ContainerCreateWithMetadataDocumentResponse,
  type ContainerDeleteResponse,
  type ContainerMutationResponse,
  type ContainerWriterProjectionResponse,
  type DocumentCreateResponse,
  type DocumentSyncResponse,
  type DocumentWriterProjectionResponse,
  isBlobAttachmentBindResponse,
  isBlobAttachmentDetachResponse,
  isChallengeResponse,
  isCompleteMultipartBlobStageResponse,
  isContainerCreateWithMetadataDocumentResponse,
  isContainerDeleteResponse,
  isContainerMutationResponse,
  isContainerWriterProjectionResponse,
  isCreateOrganizationGroupResponse,
  isCreateOrganizationResponse,
  isDeleteOrganizationGroupResponse,
  isDestroySessionResponse,
  isDocumentCreateResponse,
  isDocumentLinkSetMutationResponse,
  isDocumentPurgeResponse,
  isDocumentWriterProjectionResponse,
  isHealthResponse,
  isInitiateMultipartBlobStageResponse,
  isListContainerDocumentsResponse,
  isListDocumentAttachmentsResponse,
  isListSessionsResponse,
  isMultipartBlobStageStatusResponse,
  isOrganizationBillingHistoryResponse,
  isOrganizationBillingManagementUrlResponse,
  isOrganizationBillingResponse,
  isOrganizationDataUsageResponse,
  isOrganizationDirectoryUserResponse,
  isOrganizationGroupMembersResponse,
  isOrganizationProfileResponse,
  isOrganizationReadModelResponse,
  isPrincipalPolicyBundleResponse,
  isRegistrationResponse,
  isStripeCancelResponse,
  isStripeCheckoutIntentResponse,
  isStripeCheckoutOptionsResponse,
  isStripeCheckoutSessionResponse,
  isUploadMultipartBlobPartResponse,
  isUserIdentityResponse,
  isVerifyResponse,
  type ListContainerDocumentsResponse,
  type ListContainerParentLanesResponse,
  type ListDocumentAttachmentsResponse,
  type OrganizationDataUsageResponse,
  type OrganizationReadModelResponse,
  type PrincipalPolicyBundleResponse,
  type UserIdentityResponse,
} from "@tearleads/validators/response";
import { hasStringProperty } from "@tearleads/validators/util";
import { BoundedCache } from "./ApiCache";
import {
  bindPrototypeMethods,
  cachedRequest,
  dedupedRequest,
  describeErrorResponse,
  type ErrorResponseDescription,
  errorMessage,
  evictWriterProjectionIfSyncChanged,
  hasHeader,
  isListContainerParentLanesResponseForRequest,
  listContainerDocumentsRequestKey,
  listContainerParentLanesRequestKey,
  normalizeApiBaseUrl,
  requestFailureKey,
} from "./requestInternals";
import {
  getBlobBytes,
  type UploadMultipartBlobPartBytesRequest,
} from "./routes/blobs/get";
import { containerDocsPath } from "./routes/containers/queryParams";
import { DocumentAttributionRequests } from "./routes/documents/attributionRequests";
import { documentSync as sync } from "./routes/documents/sync";
import { organizationReadModelPath } from "./routes/organizations/readModelPath";
import { pathSegment } from "./routes/path";
import { shouldRetryAfterSessionExpired } from "./sessionRefresh";
import type {
  HttpMethod,
  ListContainerDocumentsOptions,
  ListDocumentEditAttributionRangesOptions,
  RequestBody,
  RequestFailure,
  RequestFailureKind,
  RequestFn,
  RequestResult,
  RequestResultOptions,
  ResponseRequestFn,
  ResponseRequestValidationFailureInput,
} from "./types";

const BLOB_PART_BYTE_LENGTH_HEADER = "X-Tearleads-Blob-Part-Byte-Length";
const BLOB_PART_SHA256_HEADER = "X-Tearleads-Blob-Part-Sha256";
const BLOB_PART_UPLOAD_ID_HEADER = "X-Tearleads-Blob-Upload-Id";

type ExpiredHandler = () => boolean | Promise<boolean>;
type PaymentRequiredHandler = (organizationId: string | null) => void;

// A joinable in-flight writer-projection result fetch, pinned to the value
// slot and per-key invalidation stamp it started against. A caller may join
// it only while both are unchanged — see writerProjectionResult.
interface InFlightWriterProjectionResult<T> {
  readonly invalidationStamp: number;
  readonly resultPromise: Promise<RequestResult<T>>;
  readonly slot: Promise<T | null> | undefined;
}

function isWebSocketTicketResponse(
  value: unknown,
): value is { ticket: string } {
  return isPlainObject(value) && hasStringProperty(value, "ticket");
}

export class ApiClient {
  private authToken: string | null = null;
  private readonly baseUrl: string;
  private onError: ((message: string) => void) | null = null;
  private onNetworkError: (() => void) | null = null;
  private onNetworkSuccess: (() => void) | null = null;
  private onSessionExpired: ExpiredHandler | null = null;
  private onPaymentRequired: PaymentRequiredHandler | null = null;
  private readonly containerDocumentListRequestsByKey = new Map<
    string,
    Promise<ListContainerDocumentsResponse | null>
  >();
  private readonly containerParentLaneRequestsByKey = new Map<
    string,
    Promise<ListContainerParentLanesResponse | null>
  >();
  private readonly containerWriterProjectionRequestsByContainerId =
    new BoundedCache<Promise<ContainerWriterProjectionResponse | null>>();
  private readonly documentWriterProjectionRequestsByDocumentId =
    new BoundedCache<Promise<DocumentWriterProjectionResponse | null>>();
  private readonly containerWriterProjectionResultsInFlightByContainerId =
    new Map<
      string,
      InFlightWriterProjectionResult<ContainerWriterProjectionResponse>
    >();
  private readonly documentWriterProjectionResultsInFlightByDocumentId =
    new Map<
      string,
      InFlightWriterProjectionResult<DocumentWriterProjectionResponse>
    >();
  private readonly documentAttachmentListRequestsByDocumentId =
    new BoundedCache<Promise<ListDocumentAttachmentsResponse | null>>();
  private readonly documentAttributionRequests =
    new DocumentAttributionRequests((...args) => this.request(...args));
  private readonly userIdentityRequestsByUserId = new BoundedCache<
    Promise<UserIdentityResponse | null>
  >();
  private readonly principalPolicyRequestsByKey = new BoundedCache<
    Promise<PrincipalPolicyBundleResponse | null>
  >();
  private readonly requestFailuresByKey = new Map<string, RequestFailure>();
  private readonly request: RequestFn;
  private readonly responseRequest: ResponseRequestFn;

  constructor(baseUrl?: string | null) {
    this.baseUrl = normalizeApiBaseUrl(baseUrl);
    bindPrototypeMethods(this, ApiClient.prototype);
    this.request = this.makeRequest;
    this.responseRequest = Object.assign(this.makeResponseRequest, {
      reportFailure: this.reportResponseRequestFailure,
    });
  }

  private clearAuthScopedCaches(): void {
    this.containerDocumentListRequestsByKey.clear();
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

  private invalidateDocumentAttribution(documentId: string): void {
    this.documentAttributionRequests.invalidate(documentId);
  }

  clearWriterProjectionCaches(): void {
    this.containerWriterProjectionRequestsByContainerId.clear();
    this.documentWriterProjectionRequestsByDocumentId.clear();
    this.containerWriterProjectionResultsInFlightByContainerId.clear();
    this.documentWriterProjectionResultsInFlightByDocumentId.clear();
  }

  evictUserIdentity(userId: string): void {
    this.userIdentityRequestsByUserId.delete(userId);
  }

  /**
   * Evict a single document's cached writer projection. A stale-projection
   * sync/upload retry only implicates the document it is syncing, so it evicts
   * just that entry instead of wiping every cached projection (which would force
   * a cold refetch of unrelated documents that were never stale).
   */
  evictDocumentWriterProjection(documentId: string): void {
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

  private buildHeaders(
    body: RequestBody | undefined,
    headers: Record<string, string> | undefined,
    authToken: string | null,
  ): Record<string, string> {
    return {
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(typeof body === "string" && !hasHeader(headers, "Content-Type")
        ? { "Content-Type": "application/json" }
        : {}),
      ...headers,
    };
  }

  private async makeRequest<T>(
    path: string,
    validator: (value: unknown) => value is T,
    method: HttpMethod,
    body?: RequestBody,
    options?: RequestResultOptions,
  ): Promise<T | null> {
    const result = await this.makeRequestResult(
      path,
      validator,
      method,
      body,
      options,
    );
    return result.ok ? result.data : null;
  }

  private requestFailure(input: {
    code?: string | undefined;
    kind: RequestFailureKind;
    message: string;
    method: HttpMethod;
    path: string;
    reportErrors: boolean;
    stalePrincipalPolicies: RequestFailure["stalePrincipalPolicies"];
    status: number | null;
    statusText: string;
  }): RequestFailure {
    const failure: RequestFailure = {
      ...(input.code === undefined ? {} : { code: input.code }),
      kind: input.kind,
      message: input.message,
      method: input.method,
      ok: false,
      path: input.path,
      report: () => {
        this.onError?.(input.message);
      },
      status: input.status,
      statusText: input.statusText,
      ...(input.stalePrincipalPolicies
        ? { stalePrincipalPolicies: input.stalePrincipalPolicies }
        : {}),
    };
    this.requestFailuresByKey.set(
      requestFailureKey({ method: input.method, path: input.path }),
      failure,
    );

    if (input.reportErrors) {
      failure.report();
    }

    return failure;
  }

  private async makeRequestResult<T>(
    path: string,
    validator: (value: unknown) => value is T,
    method: HttpMethod,
    body?: RequestBody,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<T>> {
    const responseResult = await this.makeResponseRequest(
      path,
      method,
      body,
      options,
    );
    if (!responseResult.ok) {
      return responseResult;
    }

    const response = responseResult.data;
    const reportErrors = options.reportErrors ?? true;
    let data: unknown;
    try {
      data = await response.json();
    } catch (e) {
      const message = errorMessage(e);
      return this.requestFailure({
        kind: "json",
        message: `${method} ${path}: failed to parse JSON: ${message}`,
        method,
        path,
        reportErrors,
        stalePrincipalPolicies: undefined,
        status: response.status,
        statusText: response.statusText,
      });
    }

    if (!validator(data)) {
      return this.requestFailure({
        kind: "shape",
        message: `Invalid response shape for ${path}`,
        method,
        path,
        reportErrors,
        stalePrincipalPolicies: undefined,
        status: response.status,
        statusText: response.statusText,
      });
    }

    return { data, ok: true };
  }

  private async makeResponseRequest(
    path: string,
    method: HttpMethod,
    body?: RequestBody,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<Response>> {
    const authToken = this.authToken;
    const responseResult = await this.fetchResponseRequest(
      path,
      method,
      body,
      options,
      authToken,
    );
    if (!responseResult.ok) {
      return responseResult;
    }

    const { response } = responseResult;
    if (response.ok) {
      this.requestFailuresByKey.delete(requestFailureKey({ method, path }));
      return { data: response, ok: true };
    }

    const errorDescription = responseResult.errorDescription;
    if (
      await shouldRetryAfterSessionExpired({
        authToken,
        body,
        error: errorDescription.error,
        getCurrentAuthToken: () => this.authToken,
        options,
        refreshSession: () => this.onSessionExpired?.() ?? false,
        reportError: (message) => this.onError?.(message),
        responseStatus: response.status,
      })
    ) {
      const retryResult = await this.fetchResponseRequest(
        path,
        method,
        body,
        options,
        this.authToken,
      );
      if (!retryResult.ok) {
        return retryResult;
      }
      if (retryResult.response.ok) {
        this.requestFailuresByKey.delete(requestFailureKey({ method, path }));
        return { data: retryResult.response, ok: true };
      }

      return this.httpFailure({
        errorDescription: retryResult.errorDescription,
        method,
        options,
        path,
        response: retryResult.response,
      });
    }

    return this.httpFailure({
      errorDescription,
      path,
      method,
      options,
      response,
    });
  }

  private async fetchResponseRequest(
    path: string,
    method: HttpMethod,
    body: RequestBody | undefined,
    options: RequestResultOptions,
    authToken: string | null,
  ): Promise<
    | RequestFailure
    | {
        readonly errorDescription: ErrorResponseDescription;
        readonly ok: true;
        readonly response: Response;
      }
  > {
    const reportErrors = options.reportErrors ?? true;
    const init: RequestInit & { duplex?: "half" } = {
      method,
      headers: this.buildHeaders(body, options.headers, authToken),
    };
    if (body !== undefined) {
      init.body = body;
      if (body instanceof ReadableStream) {
        init.duplex = "half";
      }
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, init);
    } catch (e) {
      const message = errorMessage(e);
      this.onNetworkError?.();
      return this.requestFailure({
        kind: "network",
        message: `${method} ${path}: ${message}`,
        method,
        path,
        reportErrors,
        stalePrincipalPolicies: undefined,
        status: null,
        statusText: "",
      });
    }

    this.onNetworkSuccess?.();

    if (!response.ok) {
      const errorDescription = await describeErrorResponse(response);
      return { errorDescription, ok: true, response };
    }

    return {
      errorDescription: { code: null, detail: "", error: null },
      ok: true,
      response,
    };
  }

  private httpFailure(input: {
    readonly errorDescription: ErrorResponseDescription;
    readonly method: HttpMethod;
    readonly options: RequestResultOptions;
    readonly path: string;
    readonly response: Response;
  }): RequestFailure {
    const reportErrors = input.options.reportErrors ?? true;
    if (input.response.status === 402) {
      // Surface the target organization's billing block for rejected syncs.
      this.onPaymentRequired?.(
        input.errorDescription.paymentRequiredOrganizationId ?? null,
      );
    }
    return this.requestFailure({
      ...(input.errorDescription.code === null
        ? {}
        : { code: input.errorDescription.code }),
      kind: "http",
      message: `${input.method} ${input.path}: ${input.response.status} ${input.response.statusText}${input.errorDescription.detail}`,
      method: input.method,
      path: input.path,
      reportErrors,
      stalePrincipalPolicies: input.errorDescription.stalePrincipalPolicies,
      status: input.response.status,
      statusText: input.response.statusText,
    });
  }

  private reportResponseRequestFailure(
    input: ResponseRequestValidationFailureInput,
  ): RequestFailure {
    return this.requestFailure({
      ...input,
      reportErrors: input.options?.reportErrors ?? true,
      stalePrincipalPolicies: undefined,
    });
  }

  private updateCachedDocumentAttachmentList(
    documentId: string,
    update: (
      attachments: ListDocumentAttachmentsResponse,
    ) => ListDocumentAttachmentsResponse,
  ): void {
    const cached =
      this.documentAttachmentListRequestsByDocumentId.get(documentId);
    if (!cached) {
      return;
    }

    let next: Promise<ListDocumentAttachmentsResponse | null>;
    next = cached
      .then((attachments) => {
        if (!attachments) {
          if (
            this.documentAttachmentListRequestsByDocumentId.get(documentId) ===
            next
          ) {
            this.documentAttachmentListRequestsByDocumentId.delete(documentId);
          }
          return attachments;
        }

        return update(attachments);
      })
      .catch(() => {
        // The underlying list fetch failed. Drop this derived cache entry so the
        // next read refetches, and resolve to null (the cache's miss semantics)
        // rather than rethrowing: nothing awaits this derived promise directly,
        // so a rethrow would surface as an unhandled rejection. Callers already
        // awaiting the original request still observe its rejection.
        if (
          this.documentAttachmentListRequestsByDocumentId.get(documentId) ===
          next
        ) {
          this.documentAttachmentListRequestsByDocumentId.delete(documentId);
        }
        return null;
      });
    this.documentAttachmentListRequestsByDocumentId.set(documentId, next);
  }

  private cacheBlobAttachmentBindResponse(
    response: BlobAttachmentBindResponse,
  ): void {
    this.updateCachedDocumentAttachmentList(
      response.documentId,
      (attachments) => [
        ...attachments.filter((binding) => binding.slotId !== response.slotId),
        {
          bindingId: response.bindingId,
          blobId: response.blobId,
          contentKeyBundle: response.contentKeyBundle,
          slotId: response.slotId,
        },
      ],
    );
  }

  private cacheBlobAttachmentDetachResponse(
    response: BlobAttachmentDetachResponse,
  ): void {
    this.updateCachedDocumentAttachmentList(
      response.documentId,
      (attachments) =>
        attachments.filter(
          (binding) => binding.bindingId !== response.bindingId,
        ),
    );
  }

  setOnError(handler: ((message: string) => void) | null): void {
    this.onError = handler;
  }

  setOnNetworkError(handler: (() => void) | null): void {
    this.onNetworkError = handler;
  }

  setOnNetworkSuccess(handler: (() => void) | null): void {
    this.onNetworkSuccess = handler;
  }

  setOnSessionExpired(handler: ExpiredHandler | null): void {
    this.onSessionExpired = handler;
  }

  setOnPaymentRequired(handler: PaymentRequiredHandler | null): void {
    this.onPaymentRequired = handler;
  }

  setAuthToken(token: string | null): void {
    const changed = this.authToken !== token;
    this.authToken = token;
    if (changed) {
      this.clearAuthScopedCaches();
    }
  }

  getAuthToken(): string | null {
    return this.authToken;
  }

  getRequestFailure(input: { method: HttpMethod; path: string }) {
    return this.requestFailuresByKey.get(requestFailureKey(input)) ?? null;
  }

  async requestWebSocketTicket(): Promise<string | null> {
    const response = await this.request(
      "/auth/ws-ticket",
      isWebSocketTicketResponse,
      "POST",
    );
    return response?.ticket ?? null;
  }

  getHealth() {
    return this.request("/", isHealthResponse, "GET");
  }

  registerUser(
    userId: string,
    organizationId: string,
    rootContainerId: string,
    signingPublicKey: Uint8Array,
    encapsulationPublicKey: Uint8Array,
    initialAdminGroup: RegistrationRequest["initialAdminGroup"],
    initialMemberGroup: RegistrationRequest["initialMemberGroup"],
    initialOrganizationPolicy: RegistrationRequest["initialOrganizationPolicy"],
    initialRootContainer: RegistrationRequest["initialRootContainer"],
    initialRootMetadataDocument: RegistrationRequest["initialRootMetadataDocument"],
    initialRosterProfileContainer?: RegistrationRequest["initialRosterProfileContainer"],
    initialRosterProfileDocument?: RegistrationRequest["initialRosterProfileDocument"],
    initialOrganizationMetadataContainer?: RegistrationRequest["initialOrganizationMetadataContainer"],
    initialOrganizationProfileDocument?: RegistrationRequest["initialOrganizationProfileDocument"],
    initialSystemContainers?: RegistrationRequest["initialSystemContainers"],
  ) {
    return this.request(
      "/auth/register",
      isRegistrationResponse,
      "POST",
      JSON.stringify({
        userId,
        organizationId,
        rootContainerId,
        signingPublicKey: Array.from(signingPublicKey),
        encapsulationPublicKey: Array.from(encapsulationPublicKey),
        initialAdminGroup,
        initialMemberGroup,
        initialOrganizationPolicy,
        initialRootContainer,
        initialRootMetadataDocument,
        initialRosterProfileContainer,
        initialRosterProfileDocument,
        initialOrganizationMetadataContainer,
        initialOrganizationProfileDocument,
        initialSystemContainers,
      }),
    );
  }

  createOrganization(request: CreateOrganizationRequest) {
    return this.request(
      "/organizations",
      isCreateOrganizationResponse,
      "POST",
      JSON.stringify(request),
    );
  }

  async authenticate(fingerprint: string, secretKey: Uint8Array) {
    const challenge = await this.request(
      "/auth/challenge",
      isChallengeResponse,
      "POST",
      JSON.stringify({ fingerprint }),
      { retryOnSessionExpired: false },
    );
    if (!challenge) return null;

    return this.authenticateWithChallenge(
      fingerprint,
      secretKey,
      challenge.challenge,
    );
  }

  async authenticateWithChallenge(
    fingerprint: string,
    secretKey: Uint8Array,
    challengeHex: string,
  ) {
    const signed = sign(
      authChallengeSigningBytes({ challengeHex, fingerprint }),
      secretKey,
    );
    const response = await this.request(
      "/auth/verify",
      isVerifyResponse,
      "POST",
      JSON.stringify({ fingerprint, signature: Array.from(signed) }),
      { retryOnSessionExpired: false },
    );

    return response?.authenticated ? response : null;
  }

  getUserIdentity(userId: string) {
    return cachedRequest(this.userIdentityRequestsByUserId, userId, () =>
      this.request(
        `/auth/user-identity/${pathSegment(userId)}`,
        isUserIdentityResponse,
        "GET",
      ),
    );
  }

  getUserIdentityRequestFailure(userId: string) {
    return this.getRequestFailure({
      method: "GET",
      path: `/auth/user-identity/${pathSegment(userId)}`,
    });
  }

  listSessions() {
    return this.request("/auth/sessions", isListSessionsResponse, "GET");
  }

  destroySession(sessionId: string) {
    return this.request(
      `/auth/sessions/${pathSegment(sessionId)}`,
      isDestroySessionResponse,
      "DELETE",
    );
  }

  logout() {
    return this.request(
      "/auth/logout",
      isDestroySessionResponse,
      "POST",
      undefined,
      { retryOnSessionExpired: false },
    );
  }

  getCurrentPrincipalPolicy(
    principalType: "group" | "organization",
    principalId: string,
  ) {
    return dedupedRequest(
      this.principalPolicyRequestsByKey,
      JSON.stringify([principalType, principalId]),
      () =>
        this.request(
          `/principals/${pathSegment(principalType)}/${pathSegment(principalId)}/policy`,
          isPrincipalPolicyBundleResponse,
          "GET",
        ),
    );
  }

  putPrincipalPolicy(
    principalType: "group" | "organization",
    principalId: string,
    input: PutPrincipalPolicyRequest,
  ) {
    const requestKey = JSON.stringify([principalType, principalId]);
    this.principalPolicyRequestsByKey.delete(requestKey);
    return this.request(
      `/principals/${pathSegment(principalType)}/${pathSegment(principalId)}/policy`,
      isPrincipalPolicyBundleResponse,
      "PUT",
      JSON.stringify(input),
    ).finally(() => {
      this.principalPolicyRequestsByKey.delete(requestKey);
      if (principalType === "group") {
        this.clearWriterProjectionCaches();
      }
    });
  }

  getOrganizationReadModelResult(
    organizationId: string,
    cursor?: string,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<OrganizationReadModelResponse>> {
    return this.makeRequestResult(
      organizationReadModelPath(organizationId, cursor),
      isOrganizationReadModelResponse,
      "GET",
      undefined,
      options,
    );
  }

  getOrganizationDataUsageResult(
    organizationId: string,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<OrganizationDataUsageResponse>> {
    return this.makeRequestResult(
      `/organizations/${pathSegment(organizationId)}/data-usage`,
      isOrganizationDataUsageResponse,
      "GET",
      undefined,
      options,
    );
  }

  getOrganizationBilling(organizationId: string) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/billing`,
      isOrganizationBillingResponse,
      "GET",
    );
  }

  getOrganizationBillingHistory(organizationId: string) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/billing/history`,
      isOrganizationBillingHistoryResponse,
      "GET",
    );
  }

  getOrganizationBillingManagementUrl(organizationId: string) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/billing/management-url`,
      isOrganizationBillingManagementUrlResponse,
      "GET",
    );
  }

  claimNativeOrganizationSubscription(
    organizationId: string,
    store: NativeSubscriptionStore,
  ) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/billing/native/${pathSegment(store)}/claim`,
      isOrganizationBillingResponse,
      "POST",
    );
  }
  /** Empty options means unconfigured; 403/409 remain errors. */
  getStripeCheckoutOptions(
    organizationId: string,
    options: RequestResultOptions = {},
  ) {
    return this.makeRequestResult(
      `/organizations/${pathSegment(organizationId)}/billing/stripe/options`,
      isStripeCheckoutOptionsResponse,
      "GET",
      undefined,
      options,
    );
  }

  /** Starts or resumes embedded Stripe checkout; live subscriptions return 409. */
  createStripeCheckout(organizationId: string) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/billing/stripe/checkout`,
      isStripeCheckoutIntentResponse,
      "POST",
    );
  }

  /** Starts hosted Stripe Checkout, returning its URL when configured. */
  createStripeCheckoutSession(organizationId: string, returnUrl: string) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/billing/stripe/checkout-session`,
      isStripeCheckoutSessionResponse,
      "POST",
      JSON.stringify({ returnUrl }),
    );
  }

  /** Cancels a live Stripe subscription at period end. */
  cancelStripeSubscription(organizationId: string) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/billing/stripe/cancel`,
      isStripeCancelResponse,
      "POST",
    );
  }

  startOrganizationTrial(organizationId: string) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/billing/trial`,
      isOrganizationBillingResponse,
      "POST",
    );
  }

  updateOrganizationRosterEntry(
    organizationId: string,
    userId: string,
    input: UpdateOrganizationRosterEntryRequest,
  ) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/roster/${pathSegment(userId)}`,
      isOrganizationDirectoryUserResponse,
      "PUT",
      JSON.stringify(input),
    );
  }

  updateOrganizationProfile(
    organizationId: string,
    input: UpdateOrganizationProfileRequest,
  ) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/profile`,
      isOrganizationProfileResponse,
      "PUT",
      JSON.stringify(input),
    );
  }

  createOrganizationGroup(
    organizationId: string,
    input: CreateOrganizationGroupRequest,
  ) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/groups`,
      isCreateOrganizationGroupResponse,
      "POST",
      JSON.stringify(input),
    );
  }

  deleteOrganizationGroup(organizationId: string, groupId: string) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/groups/${pathSegment(groupId)}`,
      isDeleteOrganizationGroupResponse,
      "DELETE",
    ).finally(() => this.clearWriterProjectionCaches());
  }

  listOrganizationGroupMembers(organizationId: string, groupId: string) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/groups/${pathSegment(groupId)}/members`,
      isOrganizationGroupMembersResponse,
      "GET",
    );
  }

  createDocument(input: DocumentCreateRequest) {
    return this.request(
      "/documents",
      isDocumentCreateResponse,
      "POST",
      JSON.stringify(input),
    );
  }

  createDocumentResult(
    input: DocumentCreateRequest,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<DocumentCreateResponse>> {
    return this.makeRequestResult(
      "/documents",
      isDocumentCreateResponse,
      "POST",
      JSON.stringify(input),
      options,
    );
  }

  getContainerWriterProjection(containerId: string) {
    return cachedRequest(
      this.containerWriterProjectionRequestsByContainerId,
      containerId,
      () =>
        this.request(
          `/containers/${pathSegment(containerId)}/writer-projection`,
          isContainerWriterProjectionResponse,
          "GET",
        ),
    );
  }

  getContainerWriterProjectionResult(
    containerId: string,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<ContainerWriterProjectionResponse>> {
    return this.writerProjectionResult(
      this.containerWriterProjectionRequestsByContainerId,
      this.containerWriterProjectionResultsInFlightByContainerId,
      containerId,
      `/containers/${pathSegment(containerId)}/writer-projection`,
      isContainerWriterProjectionResponse,
      options,
    );
  }

  // Shared by the writer-projection result variants: coalesce concurrent
  // result callers onto one in-flight fetch, reuse a cached success, fetch a
  // result otherwise, and reconcile the cache without ever clobbering an entry
  // that changed while the fetch was in flight.
  private writerProjectionResult<T>(
    cache: BoundedCache<Promise<T | null>>,
    inFlightResults: Map<string, InFlightWriterProjectionResult<T>>,
    cacheKey: string,
    path: string,
    validator: (value: unknown) => value is T,
    options: RequestResultOptions,
  ): Promise<RequestResult<T>> {
    // Request-affecting options make the response caller-specific: run the
    // request directly with the caller's options, join no shared fetch, and
    // never publish the outcome to the shared caches. Only reporting-only
    // callers below participate in coalescing and cache warming.
    if (
      options.headers !== undefined ||
      options.retryOnSessionExpired !== undefined
    ) {
      return this.makeRequestResult(path, validator, "GET", undefined, options);
    }

    // A concurrent burst shares one fetch — failure included — so it cannot
    // repeat the HTTP request or the 402 billing signal. The entry lives only
    // while the fetch is in flight: failures are shared, never cached, so a
    // later retry refetches. An in-flight fetch is joinable only while the
    // value slot and per-key invalidation stamp it started against are
    // unchanged: a prime, a completed plain GET, or an eviction of THIS id
    // that lands mid-flight makes the older fetch unadoptable, so a later
    // caller reads the current cache state (or fetches fresh) instead of
    // joining a fetch that predates it — while invalidations of other ids
    // leave the coalescing intact. Eviction and priming also delete the
    // entry outright; the identity guard keeps a late settle from deleting a
    // successor's entry.
    //
    // The shared fetch itself is always silent; each caller applies its OWN
    // reporting policy to the shared outcome below. Coalescing therefore
    // never lets one caller's reportErrors suppress (or force) another's,
    // and caller options never reach the request — the fetch takes none.
    const slot = cache.get(cacheKey);
    const invalidationStamp = cache.invalidationStamp(cacheKey);
    const inFlight = inFlightResults.get(cacheKey);
    let shared: Promise<RequestResult<T>>;
    if (
      inFlight &&
      inFlight.slot === slot &&
      inFlight.invalidationStamp === invalidationStamp
    ) {
      shared = inFlight.resultPromise;
    } else {
      const entry: InFlightWriterProjectionResult<T> = {
        invalidationStamp,
        resultPromise: this.fetchWriterProjectionResult(
          cache,
          cacheKey,
          path,
          validator,
        ).finally(() => {
          if (inFlightResults.get(cacheKey) === entry) {
            inFlightResults.delete(cacheKey);
          }
        }),
        slot,
      };
      inFlightResults.set(cacheKey, entry);
      shared = entry.resultPromise;
    }

    if (options.reportErrors === false) {
      return shared;
    }
    return shared.then((result) => {
      if (!result.ok) {
        result.report();
      }
      return result;
    });
  }

  // The fetch half of writerProjectionResult. Cache reconciliation guards
  // against both mid-flight slot replacement (identity comparison) and
  // mid-flight eviction of an empty slot (the per-key invalidation stamp),
  // so a projection an eviction (e.g. after a revoke) meant to drop is never
  // re-cached.
  private async fetchWriterProjectionResult<T>(
    cache: BoundedCache<Promise<T | null>>,
    cacheKey: string,
    path: string,
    validator: (value: unknown) => value is T,
  ): Promise<RequestResult<T>> {
    let cached = cache.get(cacheKey);
    while (cached) {
      try {
        const data = await cached;
        if (data) {
          return { data, ok: true };
        }
      } catch {
        // A rejected shared entry is reconciled by its own settle handler;
        // fall through either way.
      }
      // The awaited entry settled empty. Re-read the slot before fetching: a
      // newer entry installed while we awaited must be reused, not fetched
      // over — the set below would otherwise clobber it.
      const current = cache.get(cacheKey);
      if (current === cached) {
        break;
      }
      cached = current;
    }

    // The plain value cache never sees this fetch while it is in flight: a
    // published always-silent entry would hand a concurrent PLAIN caller a
    // null without its normal error reporting. Plain callers keep their own
    // fetch-and-report behavior instead, and only a success is published.
    // Always silent here: reporting is per-caller in writerProjectionResult,
    // and taking no caller options is what guarantees nothing
    // request-affecting can be smuggled into the shared fetch.
    const invalidationStamp = cache.invalidationStamp(cacheKey);
    const result = await this.makeRequestResult(
      path,
      validator,
      "GET",
      undefined,
      {
        reportErrors: false,
      },
    );

    if (result.ok) {
      // Publish the success unless the slot changed or this id was
      // invalidated mid-flight. The stamp check is what makes an eviction of
      // THIS id visible even when the slot was empty before and after the
      // flight — the case the identity comparison alone cannot see — and it
      // never caches a projection an eviction meant to drop.
      if (
        cache.get(cacheKey) === cached &&
        cache.invalidationStamp(cacheKey) === invalidationStamp
      ) {
        cache.set(cacheKey, Promise.resolve(result.data));
      }
    } else if (cached && cache.get(cacheKey) === cached) {
      // The adopted entry settled empty and the fetch confirmed there is
      // nothing to serve: drop it so a later read refetches.
      cache.delete(cacheKey);
    }

    return result;
  }

  createContainer(input: ContainerMutationRequest) {
    return this.request(
      "/containers",
      isContainerMutationResponse,
      "POST",
      JSON.stringify(input),
    );
  }

  async createContainerResult(
    input: ContainerMutationRequest,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<ContainerMutationResponse>> {
    return this.makeRequestResult(
      "/containers",
      isContainerMutationResponse,
      "POST",
      JSON.stringify(input),
      options,
    );
  }

  createContainerWithMetadataDocument(
    input: ContainerCreateWithMetadataDocumentRequest,
  ) {
    return this.request(
      "/containers/with-metadata-document",
      isContainerCreateWithMetadataDocumentResponse,
      "POST",
      JSON.stringify(input),
    );
  }

  createContainerWithMetadataDocumentResult(
    input: ContainerCreateWithMetadataDocumentRequest,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<ContainerCreateWithMetadataDocumentResponse>> {
    return this.makeRequestResult(
      "/containers/with-metadata-document",
      isContainerCreateWithMetadataDocumentResponse,
      "POST",
      JSON.stringify(input),
      options,
    );
  }

  shareContainer(containerId: string, input: ContainerMutationRequest) {
    return this.request(
      `/containers/${pathSegment(containerId)}/share`,
      isContainerMutationResponse,
      "POST",
      JSON.stringify(input),
    ).finally(() => {
      this.clearWriterProjectionCaches();
    });
  }

  revokeContainer(containerId: string, input: ContainerMutationRequest) {
    return this.request(
      `/containers/${pathSegment(containerId)}/revoke`,
      isContainerMutationResponse,
      "POST",
      JSON.stringify(input),
    ).finally(() => {
      this.clearWriterProjectionCaches();
    });
  }

  rekeyContainer(containerId: string, input: ContainerMutationRequest) {
    return this.request(
      `/containers/${pathSegment(containerId)}/rekey`,
      isContainerMutationResponse,
      "POST",
      JSON.stringify(input),
    ).finally(() => {
      this.clearWriterProjectionCaches();
    });
  }

  moveContainer(containerId: string, input: ContainerMutationRequest) {
    return this.request(
      `/containers/${pathSegment(containerId)}/move`,
      isContainerMutationResponse,
      "POST",
      JSON.stringify(input),
    ).finally(() => {
      this.clearWriterProjectionCaches();
    });
  }

  deleteContainer(containerId: string) {
    return this.request(
      `/containers/${pathSegment(containerId)}`,
      isContainerDeleteResponse,
      "DELETE",
    ).finally(() => {
      this.clearWriterProjectionCaches();
    });
  }

  deleteContainerResult(
    containerId: string,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<ContainerDeleteResponse>> {
    return this.makeRequestResult(
      `/containers/${pathSegment(containerId)}`,
      isContainerDeleteResponse,
      "DELETE",
      undefined,
      options,
    ).finally(() => {
      this.clearWriterProjectionCaches();
    });
  }

  getDocumentWriterProjection(documentId: string) {
    return cachedRequest(
      this.documentWriterProjectionRequestsByDocumentId,
      documentId,
      () =>
        this.request(
          `/documents/${pathSegment(documentId)}/writer-projection`,
          isDocumentWriterProjectionResponse,
          "GET",
        ),
    );
  }

  getDocumentEditAttribution(documentId: string, requestKey = "") {
    return this.documentAttributionRequests.get(documentId, requestKey);
  }

  listDocumentEditAttributionRanges(
    documentId: string,
    options: ListDocumentEditAttributionRangesOptions = {},
  ) {
    return this.documentAttributionRequests.listRanges(documentId, options);
  }

  getDocumentWriterProjectionResult(
    documentId: string,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<DocumentWriterProjectionResponse>> {
    return this.writerProjectionResult(
      this.documentWriterProjectionRequestsByDocumentId,
      this.documentWriterProjectionResultsInFlightByDocumentId,
      documentId,
      `/documents/${pathSegment(documentId)}/writer-projection`,
      isDocumentWriterProjectionResponse,
      options,
    );
  }

  /**
   * Seed the writer-projection cache from a mutation response the client just
   * authored, so the next read resolves locally instead of a cold
   * `GET /documents/:documentId/writer-projection`. The seed is the same
   * material a fresh fetch returns (create/link/sync responses carry the
   * manifest, content-key bundle, and KEK targets; authorizing paths are the
   * projection the client supplied). No-op when a fetch is in flight or the
   * slot is primed — never clobber an existing entry. The existing invalidation
   * paths (sync-change, share/rekey/move, link/unlink) evict a primed
   * projection that later goes stale, exactly as they evict a fetched one.
   */
  primeDocumentWriterProjection(
    documentId: string,
    projection: DocumentWriterProjectionResponse,
  ): void {
    if (this.documentWriterProjectionRequestsByDocumentId.has(documentId)) {
      return;
    }
    this.documentWriterProjectionRequestsByDocumentId.set(
      documentId,
      Promise.resolve(projection),
    );
    // The just-authored seed supersedes any GET already in flight: drop the
    // shared result entry so a post-prime result caller reads the seeded
    // projection instead of coalescing onto the older fetch. Callers already
    // holding that fetch keep their result, and its settle cannot clobber the
    // seed (the slot no longer matches its snapshot).
    this.documentWriterProjectionResultsInFlightByDocumentId.delete(documentId);
  }

  /**
   * Container counterpart of {@link primeDocumentWriterProjection}: seed the
   * container writer-projection cache from a create the client just authored so
   * the next write under that container (a child folder, a document) resolves
   * locally instead of a cold `GET /containers/:containerId/writer-projection`.
   * The seed is the same material a fresh fetch returns — the create plan's
   * authorizing path and container KEKs — validated by the caller against the
   * create response before priming. No-op when a fetch is in flight or the slot
   * is already primed, so it never clobbers a newer entry. The existing
   * invalidation (share/revoke/rekey/move/delete -> clearWriterProjectionCaches)
   * evicts a primed projection that later goes stale exactly as it evicts a
   * fetched one, so a subsequent write on stale access still fails closed and
   * retries with a fresh projection.
   */
  primeContainerWriterProjection(
    containerId: string,
    projection: ContainerWriterProjectionResponse,
  ): void {
    if (this.containerWriterProjectionRequestsByContainerId.has(containerId)) {
      return;
    }
    this.containerWriterProjectionRequestsByContainerId.set(
      containerId,
      Promise.resolve(projection),
    );
    // Same supersession rule as primeDocumentWriterProjection: a post-prime
    // result caller must read the seed, not an older in-flight GET.
    this.containerWriterProjectionResultsInFlightByContainerId.delete(
      containerId,
    );
  }

  linkDocument(documentId: string, input: DocumentLinkSetMutationRequest) {
    this.invalidateDocumentAttribution(documentId);
    return this.request(
      `/documents/${pathSegment(documentId)}/link`,
      isDocumentLinkSetMutationResponse,
      "POST",
      JSON.stringify(input),
    ).finally(() => {
      this.invalidateDocumentAttribution(documentId);
      this.evictDocumentWriterProjection(documentId);
    });
  }

  linkDocumentResult(
    documentId: string,
    input: DocumentLinkSetMutationRequest,
  ) {
    this.invalidateDocumentAttribution(documentId);
    return this.makeRequestResult(
      `/documents/${pathSegment(documentId)}/link`,
      isDocumentLinkSetMutationResponse,
      "POST",
      JSON.stringify(input),
    ).finally(() => {
      this.invalidateDocumentAttribution(documentId);
      this.evictDocumentWriterProjection(documentId);
    });
  }

  listContainerParentLanes(input: ListContainerParentLanesRequest) {
    return dedupedRequest(
      this.containerParentLaneRequestsByKey,
      listContainerParentLanesRequestKey(input),
      () =>
        this.request<ListContainerParentLanesResponse>(
          "/containers/parent-lanes/query",
          (value): value is ListContainerParentLanesResponse =>
            isListContainerParentLanesResponseForRequest(input, value),
          "POST",
          JSON.stringify(input),
        ),
    );
  }

  listContainerDocuments(
    containerId: string,
    options?: ListContainerDocumentsOptions,
  ) {
    return dedupedRequest(
      this.containerDocumentListRequestsByKey,
      listContainerDocumentsRequestKey(containerId, options),
      () =>
        this.request<ListContainerDocumentsResponse>(
          containerDocsPath(containerId, options),
          isListContainerDocumentsResponse,
          "GET",
        ),
    );
  }

  listContainerDocumentsResult(
    containerId: string,
    options?: ListContainerDocumentsOptions,
    requestOptions: RequestResultOptions = {},
  ): Promise<RequestResult<ListContainerDocumentsResponse>> {
    return this.makeRequestResult(
      containerDocsPath(containerId, options),
      isListContainerDocumentsResponse,
      "GET",
      undefined,
      requestOptions,
    );
  }

  unlinkDocument(documentId: string, input: DocumentLinkSetMutationRequest) {
    this.invalidateDocumentAttribution(documentId);
    return this.request(
      `/documents/${pathSegment(documentId)}/unlink`,
      isDocumentLinkSetMutationResponse,
      "POST",
      JSON.stringify(input),
    ).finally(() => {
      this.invalidateDocumentAttribution(documentId);
      this.evictDocumentWriterProjection(documentId);
    });
  }

  unlinkDocumentResult(
    documentId: string,
    input: DocumentLinkSetMutationRequest,
  ) {
    this.invalidateDocumentAttribution(documentId);
    return this.makeRequestResult(
      `/documents/${pathSegment(documentId)}/unlink`,
      isDocumentLinkSetMutationResponse,
      "POST",
      JSON.stringify(input),
    ).finally(() => {
      this.invalidateDocumentAttribution(documentId);
      this.evictDocumentWriterProjection(documentId);
    });
  }

  purgeDocument(documentId: string) {
    this.invalidateDocumentAttribution(documentId);
    return this.request(
      `/documents/${pathSegment(documentId)}`,
      isDocumentPurgeResponse,
      "DELETE",
    ).finally(() => {
      this.invalidateDocumentAttribution(documentId);
      this.evictDocumentWriterProjection(documentId);
      this.documentAttachmentListRequestsByDocumentId.delete(documentId);
    });
  }

  syncDocument(documentId: string, input: DocumentSyncRequest) {
    this.invalidateDocumentAttribution(documentId);
    const cachedBefore =
      this.documentWriterProjectionRequestsByDocumentId.get(documentId);
    return this.request(
      sync.path(documentId),
      sync.isResponse,
      sync.method,
      JSON.stringify(input),
    )
      .then(async (response) => {
        if (response) {
          if (response.updates.length > 0) {
            this.documentAttachmentListRequestsByDocumentId.delete(documentId);
          }
          await evictWriterProjectionIfSyncChanged(
            this.documentWriterProjectionRequestsByDocumentId,
            documentId,
            response,
            () =>
              this.documentWriterProjectionResultsInFlightByDocumentId.delete(
                documentId,
              ),
          );
        } else {
          if (
            this.documentWriterProjectionRequestsByDocumentId.get(
              documentId,
            ) === cachedBefore
          ) {
            this.documentWriterProjectionRequestsByDocumentId.delete(
              documentId,
            );
            this.documentWriterProjectionResultsInFlightByDocumentId.delete(
              documentId,
            );
          }
        }
        return response;
      })
      .catch((error: unknown) => {
        if (
          this.documentWriterProjectionRequestsByDocumentId.get(documentId) ===
          cachedBefore
        ) {
          this.documentWriterProjectionRequestsByDocumentId.delete(documentId);
          this.documentWriterProjectionResultsInFlightByDocumentId.delete(
            documentId,
          );
        }
        throw error;
      })
      .finally(() => {
        this.invalidateDocumentAttribution(documentId);
      });
  }

  async syncDocumentResult(
    documentId: string,
    input: DocumentSyncRequest,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<DocumentSyncResponse>> {
    this.invalidateDocumentAttribution(documentId);
    const cachedBefore =
      this.documentWriterProjectionRequestsByDocumentId.get(documentId);
    try {
      const result = await this.makeRequestResult(
        sync.path(documentId),
        sync.isResponse,
        sync.method,
        JSON.stringify(input),
        options,
      );
      if (result.ok) {
        if (result.data.updates.length > 0) {
          this.documentAttachmentListRequestsByDocumentId.delete(documentId);
        }
        await evictWriterProjectionIfSyncChanged(
          this.documentWriterProjectionRequestsByDocumentId,
          documentId,
          result.data,
          () =>
            this.documentWriterProjectionResultsInFlightByDocumentId.delete(
              documentId,
            ),
        );
      } else if (
        this.documentWriterProjectionRequestsByDocumentId.get(documentId) ===
        cachedBefore
      ) {
        this.documentWriterProjectionRequestsByDocumentId.delete(documentId);
        this.documentWriterProjectionResultsInFlightByDocumentId.delete(
          documentId,
        );
      }
      return result;
    } finally {
      this.invalidateDocumentAttribution(documentId);
    }
  }

  initiateMultipartBlobStage(input: InitiateMultipartBlobStageRequest) {
    return this.request(
      "/blobs/stages/multipart",
      isInitiateMultipartBlobStageResponse,
      "POST",
      JSON.stringify(input),
    );
  }

  getMultipartBlobStage(stageId: string) {
    return this.request(
      `/blobs/stages/multipart/${pathSegment(stageId)}`,
      isMultipartBlobStageStatusResponse,
      "GET",
    );
  }

  uploadMultipartBlobPartBytes(
    stageId: string,
    partNumber: number,
    input: UploadMultipartBlobPartBytesRequest,
  ) {
    // Send the encrypted part as a File — not a raw Uint8Array and not a plain
    // Blob. CapacitorHttp (enabled on the native builds so API requests bypass the
    // WKWebView's broken cross-origin fetch) serializes request bodies across the
    // JS->native bridge in its convertBody(): a Uint8Array octet-stream body is
    // `TextDecoder().decode()`d to UTF-8 there — which corrupts encrypted
    // ciphertext (arbitrary, non-UTF-8 bytes) — and a plain Blob is not recognized
    // at all, falling through as JSON (`{}`). Only a File is read byte-for-byte
    // (readAsBinaryString -> base64), so the ciphertext survives the bridge intact
    // and the server's byte-length/SHA-256 validation passes. A File is a Blob, so
    // it is equally valid on the plain web fetch path (the explicit Content-Type
    // header below still wins).
    const encryptedBody = new File(
      [input.encryptedBytes],
      "encrypted-blob-part",
      { type: "application/octet-stream" },
    );
    return this.request(
      `/blobs/stages/multipart/${pathSegment(stageId)}/parts/${pathSegment(partNumber)}/bytes`,
      isUploadMultipartBlobPartResponse,
      "PUT",
      encryptedBody,
      {
        headers: {
          "Content-Type": "application/octet-stream",
          [BLOB_PART_BYTE_LENGTH_HEADER]: input.byteLength.toString(),
          [BLOB_PART_SHA256_HEADER]: input.sha256,
          [BLOB_PART_UPLOAD_ID_HEADER]: input.uploadId,
        },
      },
    );
  }

  completeMultipartBlobStage(
    stageId: string,
    input: CompleteMultipartBlobStageRequest,
  ) {
    return this.request(
      `/blobs/stages/multipart/${pathSegment(stageId)}/complete`,
      isCompleteMultipartBlobStageResponse,
      "POST",
      JSON.stringify(input),
    );
  }

  getBlobBytes(blobId: string) {
    return getBlobBytes(this.responseRequest, blobId);
  }

  bindBlobAttachment(blobId: string, input: BlobAttachmentBindRequest) {
    return this.request(
      `/blobs/${pathSegment(blobId)}/attachment-bindings`,
      isBlobAttachmentBindResponse,
      "POST",
      JSON.stringify(input),
    )
      .then((response) => {
        if (response) {
          this.cacheBlobAttachmentBindResponse(response);
        } else {
          this.documentAttachmentListRequestsByDocumentId.clear();
        }
        return response;
      })
      .catch((error: unknown) => {
        this.documentAttachmentListRequestsByDocumentId.clear();
        throw error;
      });
  }

  detachBlobAttachment(
    blobId: string,
    bindingId: string,
    input: BlobAttachmentDetachRequest,
  ) {
    return this.request(
      `/blobs/${pathSegment(blobId)}/attachment-bindings/${pathSegment(bindingId)}/detach`,
      isBlobAttachmentDetachResponse,
      "POST",
      JSON.stringify(input),
    )
      .then((response) => {
        if (response) {
          this.cacheBlobAttachmentDetachResponse(response);
        } else {
          this.documentAttachmentListRequestsByDocumentId.clear();
        }
        return response;
      })
      .catch((error: unknown) => {
        this.documentAttachmentListRequestsByDocumentId.clear();
        throw error;
      });
  }

  listDocumentAttachments(documentId: string) {
    return cachedRequest(
      this.documentAttachmentListRequestsByDocumentId,
      documentId,
      () =>
        this.request(
          `/documents/${pathSegment(documentId)}/attachments`,
          isListDocumentAttachmentsResponse,
          "GET",
        ),
    );
  }
}
