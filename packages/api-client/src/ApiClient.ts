import type {
  BlobV2AttachmentBindRequest,
  BlobV2AttachmentDetachRequest,
  ContainerV2MutationRequest,
  DocumentV2CreateRequest,
  DocumentV2LinkSetMutationRequest,
  DocumentV2SyncRequest,
  StageBlobRequest,
} from "@tearleads/validators/request";
import {
  authenticate,
  authenticateWithChallenge,
  getEncapsulationKey,
} from "./routes/auth";
import {
  bindBlobAttachmentV2,
  detachBlobAttachmentV2,
  getBlob,
  stageBlob,
} from "./routes/blobs";
import {
  createContainerV2,
  getContainerV2WriterProjection,
  listContainerDocuments,
  listContainers,
  moveContainerV2,
  rekeyContainerV2,
  revokeContainerV2,
  shareContainerV2,
} from "./routes/containers";
import {
  createDocumentV2,
  getDocumentV2WriterProjection,
  linkDocumentV2,
  listDocumentAttachments,
  syncDocumentV2,
  unlinkDocumentV2,
} from "./routes/documents";
import { getHealth } from "./routes/health";
import { getCurrentPrincipalPolicy } from "./routes/principals";
import { postPublicKey } from "./routes/register";
import type { HttpMethod, RequestFn } from "./types";

export class ApiClient {
  private authToken: string | null = null;
  private readonly request: RequestFn;
  private onError: ((message: string) => void) | null = null;
  private onNetworkError: (() => void) | null = null;
  private onNetworkSuccess: (() => void) | null = null;

  constructor(private readonly baseUrl: string) {
    this.request = this.makeRequest.bind(this);
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
      // Fall back to the raw response body when the error payload is not JSON.
    }

    return `: ${responseText}`;
  }

  private async makeRequest<T>(
    path: string,
    validator: (value: unknown) => value is T,
    method: HttpMethod,
    body?: string,
  ): Promise<T | null> {
    const init: RequestInit = { method, headers: this.buildHeaders() };
    if (body) {
      init.body = body;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, init);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.onError?.(`${method} ${path}: ${message}`);
      this.onNetworkError?.();
      return null;
    }

    this.onNetworkSuccess?.();

    if (!response.ok) {
      const detail = await this.describeErrorResponse(response);
      this.onError?.(
        `${method} ${path}: ${response.status} ${response.statusText}${detail}`,
      );
      return null;
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.onError?.(`${method} ${path}: failed to parse JSON: ${message}`);
      return null;
    }

    if (!validator(data)) {
      this.onError?.(`Invalid response shape for ${path}`);
      return null;
    }

    return data;
  }

  getHealth() {
    return getHealth(this.request);
  }

  postPublicKey(
    userId: string,
    organizationId: string,
    rootContainerId: string,
    signingPublicKey: Uint8Array,
    encapsulationPublicKey: Uint8Array,
    initialOrganizationPolicy: Parameters<typeof postPublicKey>[6],
    initialRootContainerV2: Parameters<typeof postPublicKey>[7],
    initialRootMetadataDocumentV2: Parameters<typeof postPublicKey>[8],
  ) {
    return postPublicKey(
      this.request,
      userId,
      organizationId,
      rootContainerId,
      signingPublicKey,
      encapsulationPublicKey,
      initialOrganizationPolicy,
      initialRootContainerV2,
      initialRootMetadataDocumentV2,
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

  getCurrentPrincipalPolicy(
    principalType: "group" | "organization",
    principalId: string,
  ) {
    return getCurrentPrincipalPolicy(this.request, principalType, principalId);
  }

  createDocumentV2(input: DocumentV2CreateRequest) {
    return createDocumentV2(this.request, input);
  }

  getContainerV2WriterProjection(containerId: string) {
    return getContainerV2WriterProjection(this.request, containerId);
  }

  createContainerV2(input: ContainerV2MutationRequest) {
    return createContainerV2(this.request, input);
  }

  shareContainerV2(containerId: string, input: ContainerV2MutationRequest) {
    return shareContainerV2(this.request, containerId, input);
  }

  revokeContainerV2(containerId: string, input: ContainerV2MutationRequest) {
    return revokeContainerV2(this.request, containerId, input);
  }

  rekeyContainerV2(containerId: string, input: ContainerV2MutationRequest) {
    return rekeyContainerV2(this.request, containerId, input);
  }

  moveContainerV2(containerId: string, input: ContainerV2MutationRequest) {
    return moveContainerV2(this.request, containerId, input);
  }

  getDocumentV2WriterProjection(documentId: string) {
    return getDocumentV2WriterProjection(this.request, documentId);
  }

  linkDocumentV2(documentId: string, input: DocumentV2LinkSetMutationRequest) {
    return linkDocumentV2(this.request, documentId, input);
  }

  listContainers() {
    return listContainers(this.request);
  }

  listContainerDocuments(containerId: string) {
    return listContainerDocuments(this.request, containerId);
  }

  unlinkDocumentV2(
    documentId: string,
    input: DocumentV2LinkSetMutationRequest,
  ) {
    return unlinkDocumentV2(this.request, documentId, input);
  }

  syncDocumentV2(documentId: string, input: DocumentV2SyncRequest) {
    return syncDocumentV2(this.request, documentId, input);
  }

  stageBlob(input: StageBlobRequest) {
    return stageBlob(this.request, input);
  }

  getBlob(blobId: string) {
    return getBlob(this.request, blobId);
  }

  bindBlobAttachmentV2(blobId: string, input: BlobV2AttachmentBindRequest) {
    return bindBlobAttachmentV2(this.request, blobId, input);
  }

  detachBlobAttachmentV2(
    blobId: string,
    bindingId: string,
    input: BlobV2AttachmentDetachRequest,
  ) {
    return detachBlobAttachmentV2(this.request, blobId, bindingId, input);
  }

  listDocumentAttachments(documentId: string) {
    return listDocumentAttachments(this.request, documentId);
  }
}
