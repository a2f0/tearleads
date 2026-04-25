import { createDocument, syncDocument } from "@tearleads/loro/client";
import type {
  CommitDocumentChangeRequest,
  StageBlobRequest,
} from "@tearleads/validators/request";
import type { SerializedRecipientEnvelope } from "@tearleads/validators/util";
import {
  authenticate,
  authenticateWithChallenge,
  getEncapsulationKey,
} from "./routes/auth";
import { getBlob, stageBlob } from "./routes/blobs";
import {
  createContainer,
  listContainerDocuments,
  listContainers,
  moveContainer,
  shareContainer,
} from "./routes/containers";
import {
  commitDocumentChange,
  linkDocumentToContainer,
  listDocumentAttachments,
  unlinkDocumentFromContainer,
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
    rootContainerId: string,
    signingPublicKey: Uint8Array,
    encapsulationPublicKey: Uint8Array,
    wrappedDekEnvelope: Parameters<typeof postPublicKey>[4],
    initialRootMetadataUpdates: Parameters<typeof postPublicKey>[5],
    initialRootMetadataRecipientEnvelopes?: SerializedRecipientEnvelope[],
  ) {
    return postPublicKey(
      this.request,
      rootContainerId,
      signingPublicKey,
      encapsulationPublicKey,
      wrappedDekEnvelope,
      initialRootMetadataUpdates,
      initialRootMetadataRecipientEnvelopes,
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

  createDocument(linkedContainerIds: string[]) {
    return createDocument(this.request, linkedContainerIds);
  }

  createContainer(
    id: string,
    parentId: string,
    expectedAccessStateHash: string,
    initialMetadataUpdates: Parameters<typeof createContainer>[4],
    initialMetadataRecipientEnvelopes?: SerializedRecipientEnvelope[],
  ) {
    return createContainer(
      this.request,
      id,
      parentId,
      expectedAccessStateHash,
      initialMetadataUpdates,
      initialMetadataRecipientEnvelopes,
    );
  }

  listContainers() {
    return listContainers(this.request);
  }

  listContainerDocuments(containerId: string) {
    return listContainerDocuments(this.request, containerId);
  }

  shareContainer(
    containerId: string,
    subjectType: "user" | "group" | "organization",
    subjectId: string,
    accessLevel: "read" | "write" | "admin",
    expectedAccessStateHash: string,
  ) {
    return shareContainer(
      this.request,
      containerId,
      subjectType,
      subjectId,
      accessLevel,
      expectedAccessStateHash,
    );
  }

  moveContainer(
    containerId: string,
    parentId: string,
    expectedAccessStateHash: string,
  ) {
    return moveContainer(
      this.request,
      containerId,
      parentId,
      expectedAccessStateHash,
    );
  }

  linkDocumentToContainer(
    documentId: string,
    containerId: string,
    expectedAccessStateHash: string,
  ) {
    return linkDocumentToContainer(
      this.request,
      documentId,
      containerId,
      expectedAccessStateHash,
    );
  }

  unlinkDocumentFromContainer(
    documentId: string,
    containerId: string,
    expectedAccessStateHash: string,
  ) {
    return unlinkDocumentFromContainer(
      this.request,
      documentId,
      containerId,
      expectedAccessStateHash,
    );
  }

  syncDocument(
    documentId: string,
    accessEpoch: number,
    localVersionVector: string | null,
    outgoingUpdates: Parameters<typeof syncDocument>[4],
    documentRecipientEnvelopes?: SerializedRecipientEnvelope[],
    minLsn?: string,
    expectedAccessStateHash?: string,
  ) {
    return syncDocument(
      this.request,
      documentId,
      accessEpoch,
      localVersionVector,
      outgoingUpdates,
      documentRecipientEnvelopes,
      minLsn,
      expectedAccessStateHash,
    );
  }

  stageBlob(input: StageBlobRequest) {
    return stageBlob(this.request, input);
  }

  getBlob(blobId: string) {
    return getBlob(this.request, blobId);
  }

  listDocumentAttachments(documentId: string) {
    return listDocumentAttachments(this.request, documentId);
  }

  commitDocumentChange(documentId: string, input: CommitDocumentChangeRequest) {
    return commitDocumentChange(this.request, documentId, input);
  }
}
