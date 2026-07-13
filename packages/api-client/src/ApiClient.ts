import { authChallengeSigningBytes, sign } from "@tearleads/crypto";
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
  PutKeyPackageBackupRequest,
  PutPrincipalMemberEnvelopesRequest,
  PutPrincipalStateRequest,
  RegistrationRequest,
  StageBlobRequest,
  UpdateOrganizationProfileRequest,
  UpdateOrganizationRosterEntryRequest,
  UploadMultipartBlobPartRequest,
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
  type EncapsulationKeyResponse,
  isBlobAttachmentBindResponse,
  isBlobAttachmentDetachResponse,
  isBlobUploadCapabilitiesResponse,
  isChallengeResponse,
  isCompleteMultipartBlobStageResponse,
  isContainerCreateWithMetadataDocumentResponse,
  isContainerDeleteResponse,
  isContainerMutationResponse,
  isContainerWriterProjectionResponse,
  isCreateOrganizationGroupResponse,
  isCreateOrganizationResponse,
  isCurrentPrincipalMemberEnvelopesResponse,
  isDeleteKeyPackageBackupResponse,
  isDeleteOrganizationGroupResponse,
  isDestroySessionResponse,
  isDocumentCreateResponse,
  isDocumentEditAttributionResponse,
  isDocumentLinkSetMutationResponse,
  isDocumentPurgeResponse,
  isDocumentSyncResponse,
  isDocumentWriterProjectionResponse,
  isEncapsulationKeyResponse,
  isHealthResponse,
  isInitiateMultipartBlobStageResponse,
  isKeyPackageBackupResponse,
  isListContainerDocumentsResponse,
  isListContainersResponse,
  isListDocumentAttachmentsResponse,
  isListKeyPackageBackupsResponse,
  isListOrganizationGroupsResponse,
  isListSessionsResponse,
  isMultipartBlobStageStatusResponse,
  isOrganizationBillingResponse,
  isOrganizationContainerGrantsResponse,
  isOrganizationDataUsageResponse,
  isOrganizationDirectoryResponse,
  isOrganizationDirectoryUserResponse,
  isOrganizationGroupContainersResponse,
  isOrganizationGroupMembersResponse,
  isOrganizationProfileResponse,
  isOrganizationUserDetailResponse,
  isPrincipalPolicyBundleResponse,
  isPrincipalStateResponse,
  isRegistrationResponse,
  isStageBlobResponse,
  isUploadMultipartBlobPartResponse,
  isVerifyResponse,
  type KeyPackageBackupResponse,
  type ListContainerDocumentsResponse,
  type ListContainersResponse,
  type ListDocumentAttachmentsResponse,
  type ListOrganizationGroupsResponse,
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
  isRefreshableSessionError,
  isReplayableRequestBody,
  listContainerDocumentsRequestKey,
  listContainersRequestKey,
  normalizeApiBaseUrl,
  requestFailureKey,
} from "./requestInternals";
import {
  getBlob,
  getBlobBytes,
  type UploadMultipartBlobPartBytesRequest,
} from "./routes/blobs/get";
import {
  appendOptionalWatermark,
  appendQuery,
  containerDocsPath,
} from "./routes/containers/queryParams";
import { pathSegment } from "./routes/path";
import type {
  HttpMethod,
  ListContainerDocumentsOptions,
  ListContainersOptions,
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
  private readonly containerListRequestsByKey = new Map<
    string,
    Promise<ListContainersResponse | null>
  >();
  private readonly containerWriterProjectionRequestsByContainerId =
    new BoundedCache<Promise<ContainerWriterProjectionResponse | null>>();
  private readonly documentWriterProjectionRequestsByDocumentId =
    new BoundedCache<Promise<DocumentWriterProjectionResponse | null>>();
  private readonly documentAttachmentListRequestsByDocumentId =
    new BoundedCache<Promise<ListDocumentAttachmentsResponse | null>>();
  private readonly encapsulationKeyRequestsByUserId = new BoundedCache<
    Promise<EncapsulationKeyResponse | null>
  >();
  private readonly organizationGroupRequestsByOrganizationId = new BoundedCache<
    Promise<ListOrganizationGroupsResponse | null>
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
    this.containerListRequestsByKey.clear();
    this.documentAttachmentListRequestsByDocumentId.clear();
    this.containerWriterProjectionRequestsByContainerId.clear();
    this.documentWriterProjectionRequestsByDocumentId.clear();
    this.encapsulationKeyRequestsByUserId.clear();
    this.organizationGroupRequestsByOrganizationId.clear();
  }

  clearWriterProjectionCaches(): void {
    this.containerWriterProjectionRequestsByContainerId.clear();
    this.documentWriterProjectionRequestsByDocumentId.clear();
  }

  /**
   * Evict a single document's cached writer projection. A stale-projection
   * sync/upload retry only implicates the document it is syncing, so it evicts
   * just that entry instead of wiping every cached projection (which would force
   * a cold refetch of unrelated documents that were never stale).
   */
  evictDocumentWriterProjection(documentId: string): void {
    this.documentWriterProjectionRequestsByDocumentId.delete(documentId);
  }

  /**
   * Container counterpart of {@link evictDocumentWriterProjection}: evict a
   * single container's cached writer projection. A stale-projection create
   * retry only implicates the container it is creating under, so it evicts just
   * that entry rather than clearing the whole projection cache.
   */
  evictContainerWriterProjection(containerId: string): void {
    this.containerWriterProjectionRequestsByContainerId.delete(containerId);
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
      await this.shouldRetryAfterSessionExpired({
        authToken,
        body,
        error: errorDescription.error,
        options,
        response,
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
      errorDescription: { detail: "", error: null },
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
      // A sync call was rejected because its target org cannot sync; surface
      // the billing block so the app can prompt the user (org id from the body).
      this.onPaymentRequired?.(
        input.errorDescription.paymentRequiredOrganizationId ?? null,
      );
    }
    return this.requestFailure({
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

  private async shouldRetryAfterSessionExpired(input: {
    readonly authToken: string | null;
    readonly body: RequestBody | undefined;
    readonly error: string | null;
    readonly options: RequestResultOptions;
    readonly response: Response;
  }): Promise<boolean> {
    if (
      input.options.retryOnSessionExpired === false ||
      !input.authToken ||
      !isReplayableRequestBody(input.body) ||
      !isRefreshableSessionError(input.response.status, input.error)
    ) {
      return false;
    }

    if (this.authToken && this.authToken !== input.authToken) {
      return true;
    }

    let refreshed = false;
    try {
      refreshed = (await this.onSessionExpired?.()) ?? false;
    } catch (error: unknown) {
      if (input.options.reportErrors ?? true) {
        this.onError?.(`Session refresh failed: ${errorMessage(error)}`);
      }
    }
    return Boolean(
      refreshed && this.authToken && this.authToken !== input.authToken,
    );
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
    initialRootMetadataDocument: DocumentCreateRequest,
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

  getEncapsulationKey(userId: string) {
    return cachedRequest(this.encapsulationKeyRequestsByUserId, userId, () =>
      this.request(
        `/auth/encapsulation-key/${pathSegment(userId)}`,
        isEncapsulationKeyResponse,
        "GET",
      ),
    );
  }

  putKeyPackageBackup(input: PutKeyPackageBackupRequest) {
    return this.request(
      `/auth/key-package-backups/${pathSegment(input.backupId)}`,
      isKeyPackageBackupResponse,
      "PUT",
      JSON.stringify(input),
    );
  }

  listKeyPackageBackups() {
    return this.request(
      "/auth/key-package-backups",
      isListKeyPackageBackupsResponse,
      "GET",
    );
  }

  getKeyPackageBackupByCredentialId(
    credentialId: string,
  ): Promise<KeyPackageBackupResponse | null> {
    return this.request(
      `/auth/key-package-backups/by-credential?credentialId=${pathSegment(credentialId)}`,
      isKeyPackageBackupResponse,
      "GET",
      undefined,
      { retryOnSessionExpired: false },
    );
  }

  deleteKeyPackageBackup(backupId: string) {
    return this.request(
      `/auth/key-package-backups/${pathSegment(backupId)}`,
      isDeleteKeyPackageBackupResponse,
      "DELETE",
    );
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
    return this.request(
      `/principals/${pathSegment(principalType)}/${pathSegment(principalId)}/policy`,
      isPrincipalPolicyBundleResponse,
      "GET",
    );
  }

  putPrincipalState(
    principalType: "group" | "organization",
    principalId: string,
    input: PutPrincipalStateRequest,
  ) {
    return this.request(
      `/principals/${pathSegment(principalType)}/${pathSegment(principalId)}/state`,
      isPrincipalStateResponse,
      "PUT",
      JSON.stringify(input),
    ).finally(() => {
      if (principalType === "group") {
        this.organizationGroupRequestsByOrganizationId.clear();
        this.clearWriterProjectionCaches();
      }
    });
  }

  putPrincipalMemberEnvelopes(
    principalType: "group" | "organization",
    principalId: string,
    input: PutPrincipalMemberEnvelopesRequest,
  ) {
    return this.request(
      `/principals/${pathSegment(principalType)}/${pathSegment(principalId)}/member-envelopes`,
      isCurrentPrincipalMemberEnvelopesResponse,
      "PUT",
      JSON.stringify(input),
    ).finally(() => {
      if (principalType === "group") {
        this.organizationGroupRequestsByOrganizationId.clear();
        this.clearWriterProjectionCaches();
      }
    });
  }

  listOrganizationDirectory(organizationId: string) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/directory`,
      isOrganizationDirectoryResponse,
      "GET",
    );
  }

  listOrganizationGroups(organizationId: string) {
    return cachedRequest(
      this.organizationGroupRequestsByOrganizationId,
      organizationId,
      () =>
        this.request(
          `/organizations/${pathSegment(organizationId)}/groups`,
          isListOrganizationGroupsResponse,
          "GET",
        ),
    );
  }

  listOrganizationContainerGrants(organizationId: string) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/grants`,
      isOrganizationContainerGrantsResponse,
      "GET",
    );
  }

  getOrganizationDataUsage(organizationId: string) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/data-usage`,
      isOrganizationDataUsageResponse,
      "GET",
    );
  }

  getOrganizationBilling(organizationId: string) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/billing`,
      isOrganizationBillingResponse,
      "GET",
    );
  }

  startOrganizationTrial(organizationId: string) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/billing/trial`,
      isOrganizationBillingResponse,
      "POST",
    );
  }

  getOrganizationUserDetail(organizationId: string, userId: string) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/users/${pathSegment(userId)}/detail`,
      isOrganizationUserDetailResponse,
      "GET",
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
    ).finally(() => {
      // Invalidate only the org's group list. Creating a group grants it no
      // container access yet (that is a separate share/rekey), so no existing
      // container or document writer projection can have changed — clearing the
      // projection caches here just forced needless cold refetches.
      this.organizationGroupRequestsByOrganizationId.delete(organizationId);
    });
  }

  deleteOrganizationGroup(organizationId: string, groupId: string) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/groups/${pathSegment(groupId)}`,
      isDeleteOrganizationGroupResponse,
      "DELETE",
    ).finally(() => {
      this.organizationGroupRequestsByOrganizationId.delete(organizationId);
      this.clearWriterProjectionCaches();
    });
  }

  listOrganizationGroupMembers(organizationId: string, groupId: string) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/groups/${pathSegment(groupId)}/members`,
      isOrganizationGroupMembersResponse,
      "GET",
    );
  }

  listOrganizationGroupContainers(organizationId: string, groupId: string) {
    return this.request(
      `/organizations/${pathSegment(organizationId)}/groups/${pathSegment(groupId)}/containers`,
      isOrganizationGroupContainersResponse,
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

  getDocumentEditAttribution(documentId: string) {
    return this.request(
      `/documents/${pathSegment(documentId)}/attribution`,
      isDocumentEditAttributionResponse,
      "GET",
    );
  }

  async getDocumentWriterProjectionResult(
    documentId: string,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<DocumentWriterProjectionResponse>> {
    let cached =
      this.documentWriterProjectionRequestsByDocumentId.get(documentId);
    if (cached) {
      try {
        const data = await cached;
        if (data) {
          return { data, ok: true };
        }
      } catch {
        if (
          this.documentWriterProjectionRequestsByDocumentId.get(documentId) ===
          cached
        ) {
          this.documentWriterProjectionRequestsByDocumentId.delete(documentId);
          cached = undefined;
        }
      }
    }

    const result = await this.makeRequestResult(
      `/documents/${pathSegment(documentId)}/writer-projection`,
      isDocumentWriterProjectionResponse,
      "GET",
      undefined,
      options,
    );

    if (result.ok) {
      if (
        this.documentWriterProjectionRequestsByDocumentId.get(documentId) ===
        cached
      ) {
        this.documentWriterProjectionRequestsByDocumentId.set(
          documentId,
          Promise.resolve(result.data),
        );
      }
    } else {
      if (
        this.documentWriterProjectionRequestsByDocumentId.get(documentId) ===
        cached
      ) {
        this.documentWriterProjectionRequestsByDocumentId.delete(documentId);
      }
    }

    return result;
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
  }

  linkDocument(documentId: string, input: DocumentLinkSetMutationRequest) {
    return this.request(
      `/documents/${pathSegment(documentId)}/link`,
      isDocumentLinkSetMutationResponse,
      "POST",
      JSON.stringify(input),
    ).finally(() => {
      this.documentWriterProjectionRequestsByDocumentId.delete(documentId);
    });
  }

  listContainers(options?: ListContainersOptions) {
    return dedupedRequest(
      this.containerListRequestsByKey,
      listContainersRequestKey(options),
      () => {
        const params = new URLSearchParams();
        appendOptionalWatermark(params, options?.watermark);
        if (options?.parentId !== undefined) {
          params.set("parentId", options.parentId ?? "null");
        }
        if (options?.limit !== undefined) {
          params.set("limit", String(options.limit));
        }

        return this.request<ListContainersResponse>(
          appendQuery("/containers", params),
          isListContainersResponse,
          "GET",
        );
      },
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
    return this.request(
      `/documents/${pathSegment(documentId)}/unlink`,
      isDocumentLinkSetMutationResponse,
      "POST",
      JSON.stringify(input),
    ).finally(() => {
      this.documentWriterProjectionRequestsByDocumentId.delete(documentId);
    });
  }

  purgeDocument(documentId: string) {
    return this.request(
      `/documents/${pathSegment(documentId)}`,
      isDocumentPurgeResponse,
      "DELETE",
    ).finally(() => {
      this.documentWriterProjectionRequestsByDocumentId.delete(documentId);
      this.documentAttachmentListRequestsByDocumentId.delete(documentId);
    });
  }

  syncDocument(documentId: string, input: DocumentSyncRequest) {
    const cachedBefore =
      this.documentWriterProjectionRequestsByDocumentId.get(documentId);
    return this.request(
      `/documents/${pathSegment(documentId)}/sync`,
      isDocumentSyncResponse,
      "POST",
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
        }
        throw error;
      });
  }

  async syncDocumentResult(
    documentId: string,
    input: DocumentSyncRequest,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<DocumentSyncResponse>> {
    const cachedBefore =
      this.documentWriterProjectionRequestsByDocumentId.get(documentId);
    const result = await this.makeRequestResult(
      `/documents/${pathSegment(documentId)}/sync`,
      isDocumentSyncResponse,
      "POST",
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
      );
    } else {
      if (
        this.documentWriterProjectionRequestsByDocumentId.get(documentId) ===
        cachedBefore
      ) {
        this.documentWriterProjectionRequestsByDocumentId.delete(documentId);
      }
    }
    return result;
  }

  stageBlob(input: StageBlobRequest) {
    return this.request(
      "/blobs/stage",
      isStageBlobResponse,
      "POST",
      JSON.stringify(input),
    );
  }

  getBlobUploadCapabilities() {
    return this.request(
      "/blobs/uploads/capabilities",
      isBlobUploadCapabilitiesResponse,
      "GET",
    );
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

  uploadMultipartBlobPart(
    stageId: string,
    partNumber: number,
    input: UploadMultipartBlobPartRequest,
  ) {
    return this.request(
      `/blobs/stages/multipart/${pathSegment(stageId)}/parts/${pathSegment(partNumber)}`,
      isUploadMultipartBlobPartResponse,
      "PUT",
      JSON.stringify(input),
    );
  }

  uploadMultipartBlobPartBytes(
    stageId: string,
    partNumber: number,
    input: UploadMultipartBlobPartBytesRequest,
  ) {
    return this.request(
      `/blobs/stages/multipart/${pathSegment(stageId)}/parts/${pathSegment(partNumber)}/bytes`,
      isUploadMultipartBlobPartResponse,
      "PUT",
      input.encryptedBytes,
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

  getBlob(blobId: string) {
    return getBlob(this.responseRequest, blobId);
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
