import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
  CompleteMultipartBlobStageRequest,
  ContainerCreateWithMetadataDocumentRequest,
  ContainerMutationRequest,
  CreateOrganizationGroupRequest,
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
  DocumentSyncRequest,
  InitiateMultipartBlobStageRequest,
  PutPrincipalMemberEnvelopesRequest,
  PutPrincipalStateRequest,
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
  type DocumentSyncResponse,
  type DocumentWriterProjectionResponse,
  type EncapsulationKeyResponse,
  isContainerCreateWithMetadataDocumentResponse,
  isContainerDeleteResponse,
  isContainerMutationResponse,
  isDocumentSyncResponse,
  isDocumentWriterProjectionResponse,
  type ListContainerDocumentsResponse,
  type ListContainersResponse,
  type ListDocumentAttachmentsResponse,
  type ListOrganizationGroupsResponse,
} from "@tearleads/validators/response";
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
} from "./requestInternals";
import {
  authenticate,
  authenticateWithChallenge,
  destroySession,
  getEncapsulationKey,
  listSessions,
  logout,
} from "./routes/auth";
import {
  bindBlobAttachment,
  completeMultipartBlobStage,
  detachBlobAttachment,
  getBlob,
  getBlobBytes,
  getBlobUploadCapabilities,
  getMultipartBlobStage,
  initiateMultipartBlobStage,
  stageBlob,
  uploadMultipartBlobPart,
  uploadMultipartBlobPartBytes,
} from "./routes/blobs";
import {
  createContainer,
  createContainerWithMetadataDocument,
  deleteContainer,
  getContainerWriterProjection,
  type ListContainerDocumentsOptions,
  type ListContainersOptions,
  listContainerDocuments,
  listContainers,
  moveContainer,
  rekeyContainer,
  revokeContainer,
  shareContainer,
} from "./routes/containers";
import {
  createDocument,
  getDocumentWriterProjection,
  linkDocument,
  listDocumentAttachments,
  purgeDocument,
  syncDocument,
  unlinkDocument,
} from "./routes/documents";
import { getHealth } from "./routes/health";
import {
  createOrganizationGroup,
  deleteOrganizationGroup,
  getOrganizationDataUsage,
  getOrganizationUserDetail,
  listOrganizationContainerGrants,
  listOrganizationDirectory,
  listOrganizationGroupContainers,
  listOrganizationGroupMembers,
  listOrganizationGroups,
  updateOrganizationProfile,
  updateOrganizationRosterEntry,
} from "./routes/organizations";
import { pathSegment } from "./routes/path";
import {
  getCurrentPrincipalPolicy,
  putPrincipalMemberEnvelopes,
  putPrincipalState,
} from "./routes/principals";
import { postRegistration } from "./routes/register";
import type {
  HttpMethod,
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

export class ApiClient {
  private authToken: string | null = null;
  private readonly baseUrl: string;
  private readonly containerDocumentListRequestsByKey = new Map<
    string,
    Promise<ListContainerDocumentsResponse | null>
  >();
  private readonly containerListRequestsByKey = new Map<
    string,
    Promise<ListContainersResponse | null>
  >();
  private readonly containerWriterProjectionRequestsByContainerId = new Map<
    string,
    Promise<ContainerWriterProjectionResponse | null>
  >();
  private readonly documentWriterProjectionRequestsByDocumentId = new Map<
    string,
    Promise<DocumentWriterProjectionResponse | null>
  >();
  private readonly documentAttachmentListRequestsByDocumentId = new Map<
    string,
    Promise<ListDocumentAttachmentsResponse | null>
  >();
  private readonly encapsulationKeyRequestsByUserId = new Map<
    string,
    Promise<EncapsulationKeyResponse | null>
  >();
  private readonly organizationGroupRequestsByOrganizationId = new Map<
    string,
    Promise<ListOrganizationGroupsResponse | null>
  >();
  private readonly request: RequestFn;
  private readonly responseRequest: ResponseRequestFn;
  private onError: ((message: string) => void) | null = null;
  private onNetworkError: (() => void) | null = null;
  private onNetworkSuccess: (() => void) | null = null;
  private onSessionExpired: ExpiredHandler | null = null;

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

  private clearWriterProjectionCaches(): void {
    this.containerWriterProjectionRequestsByContainerId.clear();
    this.documentWriterProjectionRequestsByDocumentId.clear();
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
      .catch((error: unknown) => {
        if (
          this.documentAttachmentListRequestsByDocumentId.get(documentId) ===
          next
        ) {
          this.documentAttachmentListRequestsByDocumentId.delete(documentId);
        }
        throw error;
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

  setAuthToken(token: string | null): void {
    if (this.authToken !== token) {
      this.clearAuthScopedCaches();
    }
    this.authToken = token;
  }

  getAuthToken(): string | null {
    return this.authToken;
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
      // A throw means re-auth failed: do not replay, but surface it so a failing
      // silent re-login is diagnosable rather than only a downstream 401. Respect
      // the caller's reportErrors opt-out, like every other failure on this path.
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

  getHealth() {
    return getHealth(this.request);
  }

  registerUser(
    userId: string,
    organizationId: string,
    rootContainerId: string,
    signingPublicKey: Uint8Array,
    encapsulationPublicKey: Uint8Array,
    initialAdminGroup: Parameters<typeof postRegistration>[6],
    initialMemberGroup: Parameters<typeof postRegistration>[7],
    initialOrganizationPolicy: Parameters<typeof postRegistration>[8],
    initialRootContainer: Parameters<typeof postRegistration>[9],
    initialRootMetadataDocument: Parameters<typeof postRegistration>[10],
    initialRosterProfileContainer?: Parameters<typeof postRegistration>[11],
    initialRosterProfileDocument?: Parameters<typeof postRegistration>[12],
    initialOrganizationProfileDocument?: Parameters<
      typeof postRegistration
    >[13],
  ) {
    return postRegistration(
      this.request,
      userId,
      organizationId,
      rootContainerId,
      signingPublicKey,
      encapsulationPublicKey,
      initialAdminGroup,
      initialMemberGroup,
      initialOrganizationPolicy,
      initialRootContainer,
      initialRootMetadataDocument,
      initialRosterProfileContainer,
      initialRosterProfileDocument,
      initialOrganizationProfileDocument,
    );
  }

  authenticate(fingerprint: string, secretKey: Uint8Array) {
    return authenticate(this.request, fingerprint, secretKey);
  }

  authenticateWithChallenge(
    fingerprint: string,
    secretKey: Uint8Array,
    challengeHex: string,
  ) {
    return authenticateWithChallenge(
      this.request,
      fingerprint,
      secretKey,
      challengeHex,
    );
  }

  getEncapsulationKey(userId: string) {
    return cachedRequest(this.encapsulationKeyRequestsByUserId, userId, () =>
      getEncapsulationKey(this.request, userId),
    );
  }

  listSessions() {
    return listSessions(this.request);
  }

  destroySession(sessionId: string) {
    return destroySession(this.request, sessionId);
  }

  logout() {
    return logout(this.request);
  }

  getCurrentPrincipalPolicy(
    principalType: "group" | "organization",
    principalId: string,
  ) {
    return getCurrentPrincipalPolicy(this.request, principalType, principalId);
  }

  putPrincipalState(
    principalType: "group" | "organization",
    principalId: string,
    input: PutPrincipalStateRequest,
  ) {
    return putPrincipalState(
      this.request,
      principalType,
      principalId,
      input,
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
    return putPrincipalMemberEnvelopes(
      this.request,
      principalType,
      principalId,
      input,
    ).finally(() => {
      if (principalType === "group") {
        this.organizationGroupRequestsByOrganizationId.clear();
        this.clearWriterProjectionCaches();
      }
    });
  }

  listOrganizationDirectory(organizationId: string) {
    return listOrganizationDirectory(this.request, organizationId);
  }

  listOrganizationGroups(organizationId: string) {
    return cachedRequest(
      this.organizationGroupRequestsByOrganizationId,
      organizationId,
      () => listOrganizationGroups(this.request, organizationId),
    );
  }

  listOrganizationContainerGrants(organizationId: string) {
    return listOrganizationContainerGrants(this.request, organizationId);
  }

  getOrganizationDataUsage(organizationId: string) {
    return getOrganizationDataUsage(this.request, organizationId);
  }

  getOrganizationUserDetail(organizationId: string, userId: string) {
    return getOrganizationUserDetail(this.request, organizationId, userId);
  }

  updateOrganizationRosterEntry(
    organizationId: string,
    userId: string,
    input: UpdateOrganizationRosterEntryRequest,
  ) {
    return updateOrganizationRosterEntry(
      this.request,
      organizationId,
      userId,
      input,
    );
  }

  updateOrganizationProfile(
    organizationId: string,
    input: UpdateOrganizationProfileRequest,
  ) {
    return updateOrganizationProfile(this.request, organizationId, input);
  }

  createOrganizationGroup(
    organizationId: string,
    input: CreateOrganizationGroupRequest,
  ) {
    return createOrganizationGroup(this.request, organizationId, input).finally(
      () => {
        this.organizationGroupRequestsByOrganizationId.delete(organizationId);
        this.clearWriterProjectionCaches();
      },
    );
  }

  deleteOrganizationGroup(organizationId: string, groupId: string) {
    return deleteOrganizationGroup(
      this.request,
      organizationId,
      groupId,
    ).finally(() => {
      this.organizationGroupRequestsByOrganizationId.delete(organizationId);
      this.clearWriterProjectionCaches();
    });
  }

  listOrganizationGroupMembers(organizationId: string, groupId: string) {
    return listOrganizationGroupMembers(this.request, organizationId, groupId);
  }

  listOrganizationGroupContainers(organizationId: string, groupId: string) {
    return listOrganizationGroupContainers(
      this.request,
      organizationId,
      groupId,
    );
  }

  createDocument(input: DocumentCreateRequest) {
    return createDocument(this.request, input);
  }

  getContainerWriterProjection(containerId: string) {
    return cachedRequest(
      this.containerWriterProjectionRequestsByContainerId,
      containerId,
      () => getContainerWriterProjection(this.request, containerId),
    );
  }

  createContainer(input: ContainerMutationRequest) {
    return createContainer(this.request, input);
  }

  createContainerResult(
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
    return createContainerWithMetadataDocument(this.request, input);
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
    return shareContainer(this.request, containerId, input).finally(() => {
      this.clearWriterProjectionCaches();
    });
  }

  revokeContainer(containerId: string, input: ContainerMutationRequest) {
    return revokeContainer(this.request, containerId, input).finally(() => {
      this.clearWriterProjectionCaches();
    });
  }

  rekeyContainer(containerId: string, input: ContainerMutationRequest) {
    return rekeyContainer(this.request, containerId, input).finally(() => {
      this.clearWriterProjectionCaches();
    });
  }

  moveContainer(containerId: string, input: ContainerMutationRequest) {
    return moveContainer(this.request, containerId, input).finally(() => {
      this.clearWriterProjectionCaches();
    });
  }

  deleteContainer(containerId: string) {
    return deleteContainer(this.request, containerId).finally(() => {
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
      () => getDocumentWriterProjection(this.request, documentId),
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

  linkDocument(documentId: string, input: DocumentLinkSetMutationRequest) {
    return linkDocument(this.request, documentId, input).finally(() => {
      this.documentWriterProjectionRequestsByDocumentId.delete(documentId);
    });
  }

  listContainers(options?: ListContainersOptions) {
    return dedupedRequest(
      this.containerListRequestsByKey,
      listContainersRequestKey(options),
      () => listContainers(this.request, options),
    );
  }

  listContainerDocuments(
    containerId: string,
    options?: ListContainerDocumentsOptions,
  ) {
    return dedupedRequest(
      this.containerDocumentListRequestsByKey,
      listContainerDocumentsRequestKey(containerId, options),
      () => listContainerDocuments(this.request, containerId, options),
    );
  }

  unlinkDocument(documentId: string, input: DocumentLinkSetMutationRequest) {
    return unlinkDocument(this.request, documentId, input).finally(() => {
      this.documentWriterProjectionRequestsByDocumentId.delete(documentId);
    });
  }

  purgeDocument(documentId: string) {
    return purgeDocument(this.request, documentId).finally(() => {
      this.documentWriterProjectionRequestsByDocumentId.delete(documentId);
      this.documentAttachmentListRequestsByDocumentId.delete(documentId);
    });
  }

  syncDocument(documentId: string, input: DocumentSyncRequest) {
    const cachedBefore =
      this.documentWriterProjectionRequestsByDocumentId.get(documentId);
    return syncDocument(this.request, documentId, input)
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
    return stageBlob(this.request, input);
  }

  getBlobUploadCapabilities() {
    return getBlobUploadCapabilities(this.request);
  }

  initiateMultipartBlobStage(input: InitiateMultipartBlobStageRequest) {
    return initiateMultipartBlobStage(this.request, input);
  }

  getMultipartBlobStage(stageId: string) {
    return getMultipartBlobStage(this.request, stageId);
  }

  uploadMultipartBlobPart(
    stageId: string,
    partNumber: number,
    input: UploadMultipartBlobPartRequest,
  ) {
    return uploadMultipartBlobPart(this.request, stageId, partNumber, input);
  }

  uploadMultipartBlobPartBytes(
    stageId: string,
    partNumber: number,
    input: Parameters<typeof uploadMultipartBlobPartBytes>[3],
  ) {
    return uploadMultipartBlobPartBytes(
      this.request,
      stageId,
      partNumber,
      input,
    );
  }

  completeMultipartBlobStage(
    stageId: string,
    input: CompleteMultipartBlobStageRequest,
  ) {
    return completeMultipartBlobStage(this.request, stageId, input);
  }

  getBlob(blobId: string) {
    return getBlob(this.responseRequest, blobId);
  }

  getBlobBytes(blobId: string) {
    return getBlobBytes(this.responseRequest, blobId);
  }

  bindBlobAttachment(blobId: string, input: BlobAttachmentBindRequest) {
    return bindBlobAttachment(this.request, blobId, input)
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
    return detachBlobAttachment(this.request, blobId, bindingId, input)
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
      () => listDocumentAttachments(this.request, documentId),
    );
  }
}
