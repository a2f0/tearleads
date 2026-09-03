import { authChallengeSigningBytes, sign } from "@tearleads/crypto";
import type { NativeSubscriptionStore } from "@tearleads/validators/billing";
import {
  challengeOperation,
  createOrganizationOperation,
  getHealthOperation,
  getOrganizationReadModelOperation,
  registerOperation,
  verifyOperation,
  webSocketTicketOperation,
} from "@tearleads/validators/operation";
import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
  CommitOrganizationGroupPolicyRequest,
  CompleteMultipartBlobStageRequest,
  ContainerCreateWithMetadataDocumentRequest,
  ContainerMutationRequest,
  CreateOrganizationGroupWithPolicyRequest,
  CreateOrganizationRequest,
  DeleteOrganizationGroupRequest,
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
  DocumentPurgeRequest,
  DocumentSyncRequest,
  InitiateMultipartBlobStageRequest,
  ListContainerParentLanesRequest,
  OrganizationPrincipalPolicyRequest,
  RegistrationRequest,
  UpdateOrganizationProfileRequest,
  UpdateOrganizationRosterEntryRequest,
} from "@tearleads/validators/request";
import type {
  BlobAttachmentBindResponse,
  BlobAttachmentDetachResponse,
  ContainerCreateWithMetadataDocumentResponse,
  ContainerDeleteResponse,
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
  ListContainerDocumentsResponse,
  ListContainerParentLanesResponse,
  ListDocumentAttachmentsResponse,
  OrganizationDataUsageResponse,
  OrganizationReadModelResponse,
  PrincipalPolicyBundleResponse,
  UserIdentityResponse,
} from "@tearleads/validators/response";
import { BoundedCache } from "./ApiCache";
import {
  createJsonOperationTransport,
  type JsonOperationTransport,
} from "./operationTransport";
import {
  bindPrototypeMethods,
  cachedRequest,
  dedupedRequest,
  describeErrorResponse,
  type ErrorResponseDescription,
  errorMessage,
  evictWriterProjectionIfSyncChanged,
  hasHeader,
  isSuccessfulResponse,
  listContainerDocumentsRequestKey,
  listContainerParentLanesRequestKey,
  normalizeApiBaseUrl,
  requestFailureKey,
} from "./requestInternals";
import {
  destroySession as authDestroySession,
  listSessions as authListSessions,
  logout as authLogout,
  userIdentity as authUserIdentity,
} from "./routes/auth/session";
import {
  bindBlobAttachment as blobAttachmentBind,
  detachBlobAttachment as blobAttachmentDetach,
} from "./routes/blobs/attachments";
import {
  getBlobBytes,
  type UploadMultipartBlobPartBytesRequest,
} from "./routes/blobs/get";
import {
  completeMultipartBlobStage as multipartComplete,
  getMultipartBlobStage as multipartGet,
  initiateMultipartBlobStage as multipartInitiate,
  uploadMultipartBlobPartBytes as multipartPartUpload,
} from "./routes/blobs/multipart";
import {
  containerCreate,
  containerCreateWithMetadataDocument,
  containerDelete,
  containerMove,
  containerRekey,
  containerRevoke,
  containerShare,
} from "./routes/containers/mutations";
import {
  type ContainerKekLogOptions,
  containerDocuments,
  containerKekLog,
  containerParentLanes,
} from "./routes/containers/reads";
import { listDocumentAttachments as documentAttachmentsList } from "./routes/documents/attachments";
import { DocumentAttributionRequests } from "./routes/documents/attributionRequests";
import {
  type DocumentPurgeProofOptions,
  documentCreate,
  documentLink,
  documentPurge,
  documentPurgeProof,
  documentUnlink,
} from "./routes/documents/mutations";
import { documentSync as sync } from "./routes/documents/sync";
import { organizationBilling } from "./routes/organizations/billing";
import { createOrganizationGroup as groupCreate } from "./routes/organizations/createGroup";
import { getOrganizationDataUsage as organizationDataUsage } from "./routes/organizations/dataUsage";
import { deleteOrganizationGroup as groupDelete } from "./routes/organizations/deleteGroup";
import { listOrganizationGroupMembers as groupMembers } from "./routes/organizations/groupMembers";
import { updateOrganizationProfile as profileUpdate } from "./routes/organizations/profile";
import { updateOrganizationRosterEntry as rosterUpdate } from "./routes/organizations/roster";
import { organizationStripeCheckout } from "./routes/organizations/stripeCheckout";
import {
  commitOrganizationGroupPolicy as organizationGroupPolicyCommit,
  getPrincipalPolicy as principalPolicyGet,
  putPrincipalPolicy as principalPolicyPut,
} from "./routes/principals/policy";
import {
  containerWriterProjection,
  documentWriterProjection,
} from "./routes/writerProjections";
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
  private readonly documentAttributionRequests: DocumentAttributionRequests;
  private readonly userIdentityRequestsByUserId = new BoundedCache<
    Promise<UserIdentityResponse | null>
  >();
  private readonly principalPolicyRequestsByKey = new BoundedCache<
    Promise<PrincipalPolicyBundleResponse | null>
  >();
  private readonly requestFailuresByKey = new Map<string, RequestFailure>();
  private readonly transport: JsonOperationTransport;
  private readonly request: RequestFn;
  private readonly responseRequest: ResponseRequestFn;
  constructor(baseUrl?: string | null) {
    this.baseUrl = normalizeApiBaseUrl(baseUrl);
    bindPrototypeMethods(this, ApiClient.prototype);
    this.request = this.makeRequest;
    this.responseRequest = Object.assign(this.makeResponseRequest, {
      reportFailure: this.reportResponseRequestFailure,
    });
    this.transport = createJsonOperationTransport(this.responseRequest);
    this.documentAttributionRequests = new DocumentAttributionRequests(
      this.transport,
    );
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
    additionalSuccessStatuses: readonly number[] = [],
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
    const response = responseResult.data;
    if (isSuccessfulResponse(response, additionalSuccessStatuses)) {
      this.requestFailuresByKey.delete(requestFailureKey({ method, path }));
      return { data: response, ok: true };
    }

    const errorDescription = await describeErrorResponse(response);
    if (
      await shouldRetryAfterSessionExpired({
        authToken,
        body,
        code: errorDescription.code,
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
      const retryResponse = retryResult.data;
      if (isSuccessfulResponse(retryResponse, additionalSuccessStatuses)) {
        this.requestFailuresByKey.delete(requestFailureKey({ method, path }));
        return { data: retryResponse, ok: true };
      }

      return this.httpFailure({
        errorDescription: await describeErrorResponse(retryResponse),
        method,
        options,
        path,
        response: retryResponse,
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
  ): Promise<RequestResult<Response>> {
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

    return { data: response, ok: true };
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
    const {
      documentId,
      writeHeaderHash: _writeHeaderHash,
      ...binding
    } = response;
    this.updateCachedDocumentAttachmentList(documentId, (attachments) => [
      ...attachments.filter(
        (cachedBinding) => cachedBinding.slotId !== response.slotId,
      ),
      binding,
    ]);
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
    const response = await this.transport.request(webSocketTicketOperation, {
      params: {},
    });
    return response?.ticket ?? null;
  }

  getHealth() {
    return this.transport.request(getHealthOperation, { params: {} });
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
    return this.transport.request(registerOperation, {
      body: {
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
      },
      params: {},
    });
  }

  createOrganization(request: CreateOrganizationRequest) {
    return this.transport.request(createOrganizationOperation, {
      body: request,
      params: {},
    });
  }

  async authenticate(fingerprint: string, secretKey: Uint8Array) {
    const challenge = await this.transport.request(
      challengeOperation,
      { body: { fingerprint }, params: {} },
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
    const response = await this.transport.request(
      verifyOperation,
      {
        body: { fingerprint, signature: Array.from(signed) },
        params: {},
      },
      { retryOnSessionExpired: false },
    );

    return response?.authenticated ? response : null;
  }

  getUserIdentity(userId: string) {
    return cachedRequest(this.userIdentityRequestsByUserId, userId, () =>
      this.request(
        authUserIdentity.path(userId),
        authUserIdentity.isResponse,
        authUserIdentity.method,
      ),
    );
  }

  getUserIdentityRequestFailure(userId: string) {
    return this.getRequestFailure({
      method: authUserIdentity.method,
      path: authUserIdentity.path(userId),
    });
  }

  listSessions() {
    return this.request(
      authListSessions.path,
      authListSessions.isResponse,
      authListSessions.method,
    );
  }

  destroySession(sessionId: string) {
    return this.request(
      authDestroySession.path(sessionId),
      authDestroySession.isResponse,
      authDestroySession.method,
    );
  }

  logout() {
    return this.request(
      authLogout.path,
      authLogout.isResponse,
      authLogout.method,
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
          principalPolicyGet.path(principalType, principalId),
          principalPolicyGet.isResponse,
          principalPolicyGet.method,
        ),
    );
  }

  putPrincipalPolicy(
    principalType: "organization",
    principalId: string,
    input: OrganizationPrincipalPolicyRequest,
  ) {
    const requestKey = JSON.stringify([principalType, principalId]);
    this.principalPolicyRequestsByKey.delete(requestKey);
    return this.request(
      principalPolicyPut.path(principalType, principalId),
      principalPolicyPut.isResponse,
      principalPolicyPut.method,
      JSON.stringify(input),
    ).finally(() => {
      this.principalPolicyRequestsByKey.delete(requestKey);
    });
  }

  commitOrganizationGroupPolicy(
    organizationId: string,
    groupId: string,
    input: CommitOrganizationGroupPolicyRequest,
  ) {
    const groupRequestKey = JSON.stringify(["group", groupId]);
    const organizationRequestKey = JSON.stringify([
      "organization",
      organizationId,
    ]);
    this.principalPolicyRequestsByKey.delete(groupRequestKey);
    this.principalPolicyRequestsByKey.delete(organizationRequestKey);
    return this.request(
      organizationGroupPolicyCommit.path(organizationId, groupId),
      organizationGroupPolicyCommit.isResponse,
      organizationGroupPolicyCommit.method,
      JSON.stringify(input),
    ).finally(() => {
      this.principalPolicyRequestsByKey.delete(groupRequestKey);
      this.principalPolicyRequestsByKey.delete(organizationRequestKey);
      this.clearWriterProjectionCaches();
    });
  }

  getOrganizationReadModelResult(
    organizationId: string,
    cursor?: string,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<OrganizationReadModelResponse>> {
    return this.transport.requestResult(
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
    return this.makeRequestResult(
      organizationDataUsage.path(organizationId),
      organizationDataUsage.isResponse,
      organizationDataUsage.method,
      undefined,
      options,
    );
  }

  getOrganizationBilling(organizationId: string) {
    return this.request(
      organizationBilling.get.path(organizationId),
      organizationBilling.get.isResponse,
      organizationBilling.get.method,
    );
  }

  getOrganizationBillingHistory(organizationId: string) {
    return this.request(
      organizationBilling.history.path(organizationId),
      organizationBilling.history.isResponse,
      organizationBilling.history.method,
    );
  }

  getOrganizationBillingManagementUrl(organizationId: string) {
    return this.request(
      organizationBilling.managementUrl.path(organizationId),
      organizationBilling.managementUrl.isResponse,
      organizationBilling.managementUrl.method,
    );
  }

  getOrganizationNativePurchaseEligibility(
    organizationId: string,
    store: NativeSubscriptionStore,
  ) {
    return this.request(
      organizationBilling.nativeEligibility.path(organizationId, store),
      organizationBilling.nativeEligibility.isResponse,
      organizationBilling.nativeEligibility.method,
    );
  }

  claimNativeOrganizationSubscription(
    organizationId: string,
    store: NativeSubscriptionStore,
  ) {
    return this.makeRequestResult(
      organizationBilling.nativeClaim.path(organizationId, store),
      organizationBilling.nativeClaim.isResponse,
      organizationBilling.nativeClaim.method,
      undefined,
      { reportErrors: false },
    );
  }

  /** Empty options means unconfigured; 403/409 remain errors. */
  getStripeCheckoutOptions(
    organizationId: string,
    options: RequestResultOptions = {},
  ) {
    return this.makeRequestResult(
      organizationStripeCheckout.options.path(organizationId),
      organizationStripeCheckout.options.isResponse,
      organizationStripeCheckout.options.method,
      undefined,
      options,
    );
  }

  /** Starts or resumes inline checkout; an existing subscription returns 409. */
  createStripeCheckout(organizationId: string) {
    return this.request(
      organizationStripeCheckout.checkout.path(organizationId),
      organizationStripeCheckout.checkout.isResponse,
      organizationStripeCheckout.checkout.method,
    );
  }

  /** Opens hosted checkout; a null URL means unavailable or ineligible. */
  createStripeCheckoutSession(organizationId: string, returnUrl: string) {
    return this.request(
      organizationStripeCheckout.checkoutSession.path(organizationId),
      organizationStripeCheckout.checkoutSession.isResponse,
      organizationStripeCheckout.checkoutSession.method,
      JSON.stringify(
        organizationStripeCheckout.checkoutSession.body(returnUrl),
      ),
    );
  }

  /** Opens Stripe's subscription-management portal for the organization. */
  createStripePortal(organizationId: string, returnUrl: string) {
    return this.request(
      organizationStripeCheckout.portal.path(organizationId),
      organizationStripeCheckout.portal.isResponse,
      organizationStripeCheckout.portal.method,
      JSON.stringify(organizationStripeCheckout.portal.body(returnUrl)),
    );
  }

  /** Schedules period-end cancellation; any non-2xx resolves null. */
  cancelStripeSubscription(organizationId: string) {
    return this.request(
      organizationStripeCheckout.cancel.path(organizationId),
      organizationStripeCheckout.cancel.isResponse,
      organizationStripeCheckout.cancel.method,
    );
  }

  startOrganizationTrial(organizationId: string) {
    return this.request(
      organizationBilling.startTrial.path(organizationId),
      organizationBilling.startTrial.isResponse,
      organizationBilling.startTrial.method,
    );
  }

  updateOrganizationRosterEntry(
    organizationId: string,
    userId: string,
    input: UpdateOrganizationRosterEntryRequest,
  ) {
    return this.request(
      rosterUpdate.path(organizationId, userId),
      rosterUpdate.isResponse,
      rosterUpdate.method,
      JSON.stringify(input),
    );
  }

  updateOrganizationProfile(
    organizationId: string,
    input: UpdateOrganizationProfileRequest,
  ) {
    return this.request(
      profileUpdate.path(organizationId),
      profileUpdate.isResponse,
      profileUpdate.method,
      JSON.stringify(input),
    );
  }

  createOrganizationGroup(
    organizationId: string,
    input: CreateOrganizationGroupWithPolicyRequest,
  ) {
    const groupRequestKey = JSON.stringify(["group", input.groupId]);
    const organizationRequestKey = JSON.stringify([
      "organization",
      organizationId,
    ]);
    this.principalPolicyRequestsByKey.delete(groupRequestKey);
    this.principalPolicyRequestsByKey.delete(organizationRequestKey);
    return this.request(
      groupCreate.path(organizationId),
      groupCreate.isResponse,
      groupCreate.method,
      JSON.stringify(input),
    ).finally(() => {
      this.principalPolicyRequestsByKey.delete(groupRequestKey);
      this.principalPolicyRequestsByKey.delete(organizationRequestKey);
      this.clearWriterProjectionCaches();
    });
  }

  deleteOrganizationGroup(
    organizationId: string,
    groupId: string,
    input: DeleteOrganizationGroupRequest,
  ) {
    const groupRequestKey = JSON.stringify(["group", groupId]);
    const organizationRequestKey = JSON.stringify([
      "organization",
      organizationId,
    ]);
    this.principalPolicyRequestsByKey.delete(groupRequestKey);
    this.principalPolicyRequestsByKey.delete(organizationRequestKey);
    return this.request(
      groupDelete.path(organizationId, groupId),
      groupDelete.isResponse,
      groupDelete.method,
      JSON.stringify(input),
    ).finally(() => {
      this.principalPolicyRequestsByKey.delete(groupRequestKey);
      this.principalPolicyRequestsByKey.delete(organizationRequestKey);
      this.clearWriterProjectionCaches();
    });
  }

  listOrganizationGroupMembers(organizationId: string, groupId: string) {
    return this.request(
      groupMembers.path(organizationId, groupId),
      groupMembers.isResponse,
      groupMembers.method,
    );
  }

  createDocument(input: DocumentCreateRequest) {
    return this.request(
      documentCreate.path,
      documentCreate.isResponse,
      documentCreate.method,
      JSON.stringify(input),
    );
  }

  createDocumentResult(
    input: DocumentCreateRequest,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<DocumentCreateResponse>> {
    return this.makeRequestResult(
      documentCreate.path,
      documentCreate.isResponse,
      documentCreate.method,
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
          containerWriterProjection.path(containerId),
          containerWriterProjection.isResponse,
          containerWriterProjection.method,
        ),
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
    return this.request(
      containerKekLog.path(containerId, options),
      containerKekLog.isResponse,
      containerKekLog.method,
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
      containerWriterProjection.path(containerId),
      containerWriterProjection.isResponse,
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
      containerCreate.path,
      containerCreate.isResponse,
      containerCreate.method,
      JSON.stringify(input),
    );
  }

  async createContainerResult(
    input: ContainerMutationRequest,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<ContainerMutationResponse>> {
    return this.makeRequestResult(
      containerCreate.path,
      containerCreate.isResponse,
      containerCreate.method,
      JSON.stringify(input),
      options,
    );
  }

  createContainerWithMetadataDocument(
    input: ContainerCreateWithMetadataDocumentRequest,
  ) {
    return this.request(
      containerCreateWithMetadataDocument.path,
      containerCreateWithMetadataDocument.isResponse,
      containerCreateWithMetadataDocument.method,
      JSON.stringify(input),
    );
  }

  createContainerWithMetadataDocumentResult(
    input: ContainerCreateWithMetadataDocumentRequest,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<ContainerCreateWithMetadataDocumentResponse>> {
    return this.makeRequestResult(
      containerCreateWithMetadataDocument.path,
      containerCreateWithMetadataDocument.isResponse,
      containerCreateWithMetadataDocument.method,
      JSON.stringify(input),
      options,
    );
  }

  shareContainer(containerId: string, input: ContainerMutationRequest) {
    return this.request(
      containerShare.path(containerId),
      containerShare.isResponse,
      containerShare.method,
      JSON.stringify(input),
    ).finally(() => {
      this.clearWriterProjectionCaches();
    });
  }

  revokeContainer(containerId: string, input: ContainerMutationRequest) {
    return this.request(
      containerRevoke.path(containerId),
      containerRevoke.isResponse,
      containerRevoke.method,
      JSON.stringify(input),
    ).finally(() => {
      this.clearWriterProjectionCaches();
    });
  }

  rekeyContainer(containerId: string, input: ContainerMutationRequest) {
    return this.request(
      containerRekey.path(containerId),
      containerRekey.isResponse,
      containerRekey.method,
      JSON.stringify(input),
    ).finally(() => {
      this.clearWriterProjectionCaches();
    });
  }

  moveContainer(containerId: string, input: ContainerMutationRequest) {
    return this.request(
      containerMove.path(containerId),
      containerMove.isResponse,
      containerMove.method,
      JSON.stringify(input),
    ).finally(() => {
      this.clearWriterProjectionCaches();
    });
  }

  deleteContainer(containerId: string) {
    return this.request(
      containerDelete.path(containerId),
      containerDelete.isResponse,
      containerDelete.method,
    ).finally(() => {
      this.clearWriterProjectionCaches();
    });
  }

  deleteContainerResult(
    containerId: string,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<ContainerDeleteResponse>> {
    return this.makeRequestResult(
      containerDelete.path(containerId),
      containerDelete.isResponse,
      containerDelete.method,
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
          documentWriterProjection.path(documentId),
          documentWriterProjection.isResponse,
          documentWriterProjection.method,
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
      documentWriterProjection.path(documentId),
      documentWriterProjection.isResponse,
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
      documentLink.path(documentId),
      documentLink.isResponse,
      documentLink.method,
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
      documentLink.path(documentId),
      documentLink.isResponse,
      documentLink.method,
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
          containerParentLanes.path,
          (value): value is ListContainerParentLanesResponse =>
            containerParentLanes.isResponseForRequest(input, value),
          containerParentLanes.method,
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
          containerDocuments.path(containerId, options),
          containerDocuments.isResponse,
          containerDocuments.method,
        ),
    );
  }

  listContainerDocumentsResult(
    containerId: string,
    options?: ListContainerDocumentsOptions,
    requestOptions: RequestResultOptions = {},
  ): Promise<RequestResult<ListContainerDocumentsResponse>> {
    return this.makeRequestResult(
      containerDocuments.path(containerId, options),
      containerDocuments.isResponse,
      containerDocuments.method,
      undefined,
      requestOptions,
    );
  }

  unlinkDocument(documentId: string, input: DocumentLinkSetMutationRequest) {
    this.invalidateDocumentAttribution(documentId);
    return this.request(
      documentUnlink.path(documentId),
      documentUnlink.isResponse,
      documentUnlink.method,
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
      documentUnlink.path(documentId),
      documentUnlink.isResponse,
      documentUnlink.method,
      JSON.stringify(input),
    ).finally(() => {
      this.invalidateDocumentAttribution(documentId);
      this.evictDocumentWriterProjection(documentId);
    });
  }

  purgeDocument(documentId: string, input: DocumentPurgeRequest) {
    this.invalidateDocumentAttribution(documentId);
    return this.request(
      documentPurge.path(documentId),
      documentPurge.isResponse,
      documentPurge.method,
      JSON.stringify(input),
    ).finally(() => {
      this.invalidateDocumentAttribution(documentId);
      this.evictDocumentWriterProjection(documentId);
      this.documentAttachmentListRequestsByDocumentId.delete(documentId);
    });
  }

  getDocumentPurgeProof(
    documentId: string,
    options?: DocumentPurgeProofOptions,
  ) {
    return this.request(
      documentPurgeProof.path(documentId, options),
      documentPurgeProof.isResponse,
      documentPurgeProof.method,
    );
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
      multipartInitiate.path,
      multipartInitiate.isResponse,
      multipartInitiate.method,
      JSON.stringify(input),
    );
  }

  getMultipartBlobStage(stageId: string) {
    return this.request(
      multipartGet.path(stageId),
      multipartGet.isResponse,
      multipartGet.method,
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
      multipartPartUpload.path(stageId, partNumber),
      multipartPartUpload.isResponse,
      multipartPartUpload.method,
      encryptedBody,
      {
        headers: {
          "Content-Type": "application/octet-stream",
          [multipartPartUpload.headerNames.byteLength]:
            input.byteLength.toString(),
          [multipartPartUpload.headerNames.sha256]: input.sha256,
          [multipartPartUpload.headerNames.uploadId]: input.uploadId,
        },
      },
    );
  }

  completeMultipartBlobStage(
    stageId: string,
    input: CompleteMultipartBlobStageRequest,
  ) {
    return this.request(
      multipartComplete.path(stageId),
      multipartComplete.isResponse,
      multipartComplete.method,
      JSON.stringify(input),
    );
  }

  getBlobBytes(blobId: string) {
    return getBlobBytes(this.responseRequest, blobId);
  }

  bindBlobAttachment(blobId: string, input: BlobAttachmentBindRequest) {
    return this.request(
      blobAttachmentBind.path(blobId),
      blobAttachmentBind.isResponse,
      blobAttachmentBind.method,
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
      blobAttachmentDetach.path(blobId, bindingId),
      blobAttachmentDetach.isResponse,
      blobAttachmentDetach.method,
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
          documentAttachmentsList.path(documentId),
          documentAttachmentsList.isResponse,
          documentAttachmentsList.method,
        ),
    );
  }
}
