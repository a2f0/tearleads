import { createDocument, syncDocument } from "@tearleads/loro/client";
import type {
  CommitDocumentChangeRequest,
  StageBlobRequest,
} from "@tearleads/validators/request";
import {
  authenticate,
  authenticateWithChallenge,
  getEncapsulationKey,
} from "./routes/auth";
import { stageBlob } from "./routes/blobs";
import { commitDocumentChange } from "./routes/documents";
import { getHealth } from "./routes/health";
import { getItem, postItem } from "./routes/items";
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
      this.onError?.(
        `${method} ${path}: ${response.status} ${response.statusText}`,
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
    signingPublicKey: Uint8Array,
    encapsulationPublicKey: Uint8Array,
    wrappedDekEnvelope: Parameters<typeof postPublicKey>[3],
  ) {
    return postPublicKey(
      this.request,
      signingPublicKey,
      encapsulationPublicKey,
      wrappedDekEnvelope,
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

  createDocument() {
    return createDocument(this.request);
  }

  syncDocument(
    documentId: string,
    accessEpoch: number,
    localVersionVector: string | null,
    outgoingUpdates: Parameters<typeof syncDocument>[4],
  ) {
    return syncDocument(
      this.request,
      documentId,
      accessEpoch,
      localVersionVector,
      outgoingUpdates,
    );
  }

  stageBlob(input: StageBlobRequest) {
    return stageBlob(this.request, input);
  }

  commitDocumentChange(documentId: string, input: CommitDocumentChangeRequest) {
    return commitDocumentChange(this.request, documentId, input);
  }

  getItem(itemId: string) {
    return getItem(this.request, itemId);
  }

  postItem(encryptedData: string) {
    return postItem(this.request, encryptedData);
  }
}
