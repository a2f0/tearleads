import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
  CompleteMultipartBlobStageRequest,
  ContainerMutationRequest,
  CreateOrganizationGroupRequest,
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
  DocumentSyncRequest,
  InitiateMultipartBlobStageRequest,
  PutPrincipalMemberEnvelopesRequest,
  PutPrincipalStateRequest,
  StageBlobRequest,
  UploadMultipartBlobPartRequest,
} from "@tearleads/validators/request";
import {
  type ContainerDeleteResponse,
  type DocumentSyncResponse,
  isContainerDeleteResponse,
  isDocumentSyncResponse,
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
} from "./routes/organizations";
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
  const instanceRecord = instance as Record<string, unknown>;
  const prototypeRecord = prototype as Record<string, unknown>;

  for (const propertyName of Object.getOwnPropertyNames(prototypeRecord)) {
    if (propertyName === "constructor") {
      continue;
    }

    const property = prototypeRecord[propertyName];
    if (typeof property === "function") {
      instanceRecord[propertyName] = property.bind(instance);
    }
  }
}

export class ApiClient {
  private authToken: string | null = null;
  private readonly request: RequestFn;
  private readonly responseRequest: ResponseRequestFn;
  private onError: ((message: string) => void) | null = null;
  private onNetworkError: (() => void) | null = null;
  private onNetworkSuccess: (() => void) | null = null;

  constructor(private readonly baseUrl: string) {
    bindPrototypeMethods(this, ApiClient.prototype);
    this.request = this.makeRequest;
    this.responseRequest = Object.assign(this.makeResponseRequest, {
      reportFailure: this.reportResponseRequestFailure,
    });
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
    this.authToken = token;
  }

  getAuthToken(): string | null {
    return this.authToken;
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
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
      headers: {
        ...this.buildHeaders(),
        ...options.headers,
      },
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
    return getEncapsulationKey(this.request, userId);
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
    return putPrincipalState(this.request, principalType, principalId, input);
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
    );
  }

  listOrganizationDirectory(organizationId: string) {
    return listOrganizationDirectory(this.request, organizationId);
  }

  listOrganizationGroups(organizationId: string) {
    return listOrganizationGroups(this.request, organizationId);
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

  createOrganizationGroup(
    organizationId: string,
    input: CreateOrganizationGroupRequest,
  ) {
    return createOrganizationGroup(this.request, organizationId, input);
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
    return getContainerWriterProjection(this.request, containerId);
  }

  createContainer(input: ContainerMutationRequest) {
    return createContainer(this.request, input);
  }

  shareContainer(containerId: string, input: ContainerMutationRequest) {
    return shareContainer(this.request, containerId, input);
  }

  revokeContainer(containerId: string, input: ContainerMutationRequest) {
    return revokeContainer(this.request, containerId, input);
  }

  rekeyContainer(containerId: string, input: ContainerMutationRequest) {
    return rekeyContainer(this.request, containerId, input);
  }

  moveContainer(containerId: string, input: ContainerMutationRequest) {
    return moveContainer(this.request, containerId, input);
  }

  deleteContainer(containerId: string) {
    return deleteContainer(this.request, containerId);
  }

  deleteContainerResult(
    containerId: string,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<ContainerDeleteResponse>> {
    return this.makeRequestResult(
      `/containers/${containerId}`,
      isContainerDeleteResponse,
      "DELETE",
      undefined,
      options,
    );
  }

  getDocumentWriterProjection(documentId: string) {
    return getDocumentWriterProjection(this.request, documentId);
  }

  linkDocument(documentId: string, input: DocumentLinkSetMutationRequest) {
    return linkDocument(this.request, documentId, input);
  }

  listContainers(options?: ListContainersOptions) {
    return listContainers(this.request, options);
  }

  listContainerDocuments(
    containerId: string,
    options?: ListContainerDocumentsOptions,
  ) {
    return listContainerDocuments(this.request, containerId, options);
  }

  unlinkDocument(documentId: string, input: DocumentLinkSetMutationRequest) {
    return unlinkDocument(this.request, documentId, input);
  }

  syncDocument(documentId: string, input: DocumentSyncRequest) {
    return syncDocument(this.request, documentId, input);
  }

  syncDocumentResult(
    documentId: string,
    input: DocumentSyncRequest,
    options: RequestResultOptions = {},
  ): Promise<RequestResult<DocumentSyncResponse>> {
    return this.makeRequestResult(
      `/documents/${documentId}/sync`,
      isDocumentSyncResponse,
      "POST",
      JSON.stringify(input),
      options,
    );
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
