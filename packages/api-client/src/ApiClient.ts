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
  UpdateOrganizationRosterEntryRequest,
  UploadMultipartBlobPartRequest,
} from "@tearleads/validators/request";
import {
  type ContainerDeleteResponse,
  type ContainerWriterProjectionResponse,
  type DocumentSyncResponse,
  type DocumentWriterProjectionResponse,
  type EncapsulationKeyResponse,
  isContainerDeleteResponse,
  isDocumentSyncResponse,
  type ListContainerDocumentsResponse,
  type ListContainersResponse,
  type ListOrganizationGroupsResponse,
  type SyncWatermark,
} from "@tearleads/validators/response";
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
  syncDocument,
  unlinkDocument,
} from "./routes/documents";
import { getHealth } from "./routes/health";
import {
  createOrganizationGroup,
  getOrganizationDataUsage,
  getOrganizationUserDetail,
  listOrganizationContainerGrants,
  listOrganizationDirectory,
  listOrganizationGroupContainers,
  listOrganizationGroupMembers,
  listOrganizationGroups,
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

function bindPrototypeMethods(instance: object, prototype: object): void {
  for (const propertyName of Object.getOwnPropertyNames(prototype)) {
    if (propertyName === "constructor") {
      continue;
    }

    const property = Reflect.get(prototype, propertyName);
    if (typeof property === "function") {
      Reflect.set(instance, propertyName, property.bind(instance));
    }
  }
}

function normalizeApiBaseUrl(baseUrl: string | null | undefined): string {
  const trimmed = (baseUrl ?? "").trim();
  if (trimmed === "" || trimmed === "/") {
    return "";
  }

  return trimmed.replace(/\/+$/u, "");
}

function hasHeader(
  headers: Record<string, string> | undefined,
  name: string,
): boolean {
  const normalizedName = name.toLowerCase();
  return Object.keys(headers ?? {}).some(
    (headerName) => headerName.toLowerCase() === normalizedName,
  );
}

function syncWatermarkRequestKey(
  watermark: SyncWatermark | null | undefined,
): string {
  return watermark ? `${watermark.updatedAt}\u0000${watermark.id}` : "";
}

function listContainersRequestKey(options: ListContainersOptions = {}): string {
  const { watermark, ...rest } = options;
  return JSON.stringify({
    ...rest,
    parentId: rest.parentId === undefined ? "__undefined__" : rest.parentId,
    watermark: syncWatermarkRequestKey(watermark),
  });
}

function listContainerDocumentsRequestKey(
  containerId: string,
  options: ListContainerDocumentsOptions = {},
): string {
  const { watermark, ...rest } = options;
  return JSON.stringify({
    containerId,
    ...rest,
    watermark: syncWatermarkRequestKey(watermark),
  });
}

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

  constructor(baseUrl?: string | null) {
    this.baseUrl = normalizeApiBaseUrl(baseUrl);
    bindPrototypeMethods(this, ApiClient.prototype);
    this.request = this.makeRequest;
    this.responseRequest = Object.assign(this.makeResponseRequest, {
      reportFailure: this.reportResponseRequestFailure,
    });
  }

  private cachedRequest<T>(
    cache: Map<string, Promise<T | null>>,
    cacheKey: string,
    request: () => Promise<T | null>,
  ): Promise<T | null> {
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    let pending: Promise<T | null>;
    pending = request()
      .then((response) => {
        if (!response && cache.get(cacheKey) === pending) {
          cache.delete(cacheKey);
        }
        return response;
      })
      .catch((error: unknown) => {
        if (cache.get(cacheKey) === pending) {
          cache.delete(cacheKey);
        }
        throw error;
      });
    cache.set(cacheKey, pending);
    return pending;
  }

  private dedupedRequest<T>(
    cache: Map<string, Promise<T | null>>,
    cacheKey: string,
    request: () => Promise<T | null>,
  ): Promise<T | null> {
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    let pending: Promise<T | null>;
    pending = request().finally(() => {
      if (cache.get(cacheKey) === pending) {
        cache.delete(cacheKey);
      }
    });
    cache.set(cacheKey, pending);
    return pending;
  }

  private clearAuthScopedCaches(): void {
    this.containerDocumentListRequestsByKey.clear();
    this.containerListRequestsByKey.clear();
    this.containerWriterProjectionRequestsByContainerId.clear();
    this.documentWriterProjectionRequestsByDocumentId.clear();
    this.encapsulationKeyRequestsByUserId.clear();
    this.organizationGroupRequestsByOrganizationId.clear();
  }

  private clearWriterProjectionCaches(): void {
    this.containerWriterProjectionRequestsByContainerId.clear();
    this.documentWriterProjectionRequestsByDocumentId.clear();
  }

  private async clearDocumentWriterProjectionCacheIfSyncChanged(
    documentId: string,
    response: DocumentSyncResponse,
  ): Promise<void> {
    const cached =
      this.documentWriterProjectionRequestsByDocumentId.get(documentId);
    if (!cached) {
      return;
    }

    const writerProjection = await cached.catch(() => null);
    if (
      this.documentWriterProjectionRequestsByDocumentId.get(documentId) !==
        cached ||
      !writerProjection
    ) {
      return;
    }

    if (
      writerProjection.contentKeyBundle?.contentKeyEpoch !==
        response.contentKeyBundle?.contentKeyEpoch ||
      writerProjection.contentKeyBundle?.linkSetManifestHash !==
        response.contentKeyBundle?.linkSetManifestHash ||
      writerProjection.contentKeyBundle?.targetHash !==
        response.contentKeyBundle?.targetHash ||
      writerProjection.documentKekTargets?.linkSetManifestHash !==
        response.documentKekTargets?.linkSetManifestHash ||
      writerProjection.documentKekTargets?.documentKeyTargetHash !==
        response.documentKekTargets?.documentKeyTargetHash
    ) {
      this.documentWriterProjectionRequestsByDocumentId.delete(documentId);
    }
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
  ): Record<string, string> {
    return {
      ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
      ...(typeof body === "string" && !hasHeader(headers, "Content-Type")
        ? { "Content-Type": "application/json" }
        : {}),
      ...headers,
    };
  }

  private async describeErrorResponse(response: Response): Promise<string> {
    let responseText = "";

    try {
      responseText = (await response.text()).trim();
    } catch {
      return "";
    }

    if (responseText.length === 0) {
      return "";
    }

    try {
      const parsed = JSON.parse(responseText);
      if (
        parsed &&
        typeof parsed === "object" &&
        "error" in parsed &&
        typeof parsed.error === "string" &&
        parsed.error.trim().length > 0
      ) {
        return `: ${parsed.error.trim()}`;
      }
    } catch {
      // Use the raw response body when the error payload is not JSON.
    }

    return `: ${responseText}`;
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
      const message = e instanceof Error ? e.message : String(e);
      return this.requestFailure({
        kind: "json",
        message: `${method} ${path}: failed to parse JSON: ${message}`,
        method,
        path,
        reportErrors,
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
    const reportErrors = options.reportErrors ?? true;
    const init: RequestInit & { duplex?: "half" } = {
      method,
      headers: this.buildHeaders(body, options.headers),
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
      const message = e instanceof Error ? e.message : String(e);
      this.onNetworkError?.();
      return this.requestFailure({
        kind: "network",
        message: `${method} ${path}: ${message}`,
        method,
        path,
        reportErrors,
        status: null,
        statusText: "",
      });
    }

    this.onNetworkSuccess?.();

    if (!response.ok) {
      const detail = await this.describeErrorResponse(response);
      return this.requestFailure({
        kind: "http",
        message: `${method} ${path}: ${response.status} ${response.statusText}${detail}`,
        method,
        path,
        reportErrors,
        status: response.status,
        statusText: response.statusText,
      });
    }

    return { data: response, ok: true };
  }

  private reportResponseRequestFailure(
    input: ResponseRequestValidationFailureInput,
  ): RequestFailure {
    return this.requestFailure({
      ...input,
      reportErrors: input.options?.reportErrors ?? true,
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
    return this.cachedRequest(
      this.encapsulationKeyRequestsByUserId,
      userId,
      () => getEncapsulationKey(this.request, userId),
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
    return this.cachedRequest(
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
    return this.cachedRequest(
      this.containerWriterProjectionRequestsByContainerId,
      containerId,
      () => getContainerWriterProjection(this.request, containerId),
    );
  }

  createContainer(input: ContainerMutationRequest) {
    return createContainer(this.request, input);
  }

  createContainerWithMetadataDocument(
    input: ContainerCreateWithMetadataDocumentRequest,
  ) {
    return createContainerWithMetadataDocument(this.request, input);
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
    return this.cachedRequest(
      this.documentWriterProjectionRequestsByDocumentId,
      documentId,
      () => getDocumentWriterProjection(this.request, documentId),
    );
  }

  linkDocument(documentId: string, input: DocumentLinkSetMutationRequest) {
    return linkDocument(this.request, documentId, input).finally(() => {
      this.documentWriterProjectionRequestsByDocumentId.delete(documentId);
    });
  }

  listContainers(options?: ListContainersOptions) {
    return this.dedupedRequest(
      this.containerListRequestsByKey,
      listContainersRequestKey(options),
      () => listContainers(this.request, options),
    );
  }

  listContainerDocuments(
    containerId: string,
    options?: ListContainerDocumentsOptions,
  ) {
    return this.dedupedRequest(
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

  syncDocument(documentId: string, input: DocumentSyncRequest) {
    const cachedBefore =
      this.documentWriterProjectionRequestsByDocumentId.get(documentId);
    return syncDocument(this.request, documentId, input)
      .then(async (response) => {
        if (response) {
          await this.clearDocumentWriterProjectionCacheIfSyncChanged(
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
      await this.clearDocumentWriterProjectionCacheIfSyncChanged(
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
    return bindBlobAttachment(this.request, blobId, input);
  }

  detachBlobAttachment(
    blobId: string,
    bindingId: string,
    input: BlobAttachmentDetachRequest,
  ) {
    return detachBlobAttachment(this.request, blobId, bindingId, input);
  }

  listDocumentAttachments(documentId: string) {
    return listDocumentAttachments(this.request, documentId);
  }
}
