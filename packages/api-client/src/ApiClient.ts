import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
  ContainerMutationRequest,
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
  DocumentSyncRequest,
  StageBlobRequest,
} from "@tearleads/validators/request";
import {
  authenticate,
  authenticateWithChallenge,
  getEncapsulationKey,
} from "./routes/auth";
import {
  bindBlobAttachment,
  detachBlobAttachment,
  getBlob,
  stageBlob,
} from "./routes/blobs";
import {
  createContainer,
  getContainerWriterProjection,
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
import { getCurrentPrincipalPolicy } from "./routes/principals";
import { postPublicKey } from "./routes/register";
import type { HttpMethod, RequestFn } from "./types";

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
  private onError: ((message: string) => void) | null = null;
  private onNetworkError: (() => void) | null = null;
  private onNetworkSuccess: (() => void) | null = null;

  constructor(private readonly baseUrl: string) {
    bindPrototypeMethods(this, ApiClient.prototype);
    this.request = this.makeRequest;
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
    initialRootContainer: Parameters<typeof postPublicKey>[7],
    initialRootMetadataDocument: Parameters<typeof postPublicKey>[8],
  ) {
    return postPublicKey(
      this.request,
      userId,
      organizationId,
      rootContainerId,
      signingPublicKey,
      encapsulationPublicKey,
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

  getCurrentPrincipalPolicy(
    principalType: "group" | "organization",
    principalId: string,
  ) {
    return getCurrentPrincipalPolicy(this.request, principalType, principalId);
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

  getDocumentWriterProjection(documentId: string) {
    return getDocumentWriterProjection(this.request, documentId);
  }

  linkDocument(documentId: string, input: DocumentLinkSetMutationRequest) {
    return linkDocument(this.request, documentId, input);
  }

  listContainers() {
    return listContainers(this.request);
  }

  listContainerDocuments(containerId: string) {
    return listContainerDocuments(this.request, containerId);
  }

  unlinkDocument(documentId: string, input: DocumentLinkSetMutationRequest) {
    return unlinkDocument(this.request, documentId, input);
  }

  syncDocument(documentId: string, input: DocumentSyncRequest) {
    return syncDocument(this.request, documentId, input);
  }

  stageBlob(input: StageBlobRequest) {
    return stageBlob(this.request, input);
  }

  getBlob(blobId: string) {
    return getBlob(this.request, blobId);
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
