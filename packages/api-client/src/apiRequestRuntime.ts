import {
  apiVersionHeaderName,
  parseApiVersion,
} from "@tearleads/validators/operation";
import type { ApiRequestInstrumentation } from "./apiRequestMetrics";
import { boundedMetadataResponse } from "./boundedMetadataResponse";
import { measureApiRequest } from "./measureApiRequest";
import {
  type ApiNetworkError,
  networkFailureMessage,
  settleNetworkFailure,
} from "./networkFailure";
import { RequestFailureCache } from "./requestFailureCache";
import {
  bindPrototypeMethods,
  describeErrorResponse,
  type ErrorResponseDescription,
  isSuccessfulResponse,
  normalizeApiBaseUrl,
} from "./requestInternals";
import { resourceRequestActivity } from "./resourceRequestActivity";
import { shouldRetryAfterSessionExpired } from "./sessionRefresh";
import {
  type SessionBoundary,
  SessionRenewalTracker,
  sessionAuthChallengeBytes,
} from "./sessionRenewal";
import { sessionRequestInit } from "./sessionRequestInit";
import {
  readSessionJson,
  requestRetired,
  responseRetired,
  retiredRequest,
  retiredResponse,
} from "./sessionResponse";
import type {
  HttpMethod,
  OperationRequestFn,
  OperationRequestResultFn,
  OperationResponseRequestFn,
  RequestBody,
  RequestFailure,
  RequestFailureKind,
  RequestResult,
  RequestResultOptions,
  ResponseRequestValidationFailureInput,
} from "./types";

type ExpiredHandler = () => boolean | Promise<boolean>;
type PaymentRequiredHandler = (organizationId: string | null) => void;

export class ApiRequestRuntime {
  private authToken: string | null = null;
  private readonly sessionRenewals = new SessionRenewalTracker(
    () => this.authToken,
  );
  private readonly baseUrl: string;
  private onError: ((message: string) => void) | null = null;
  private onNetworkError: (() => void) | null = null;
  private onNetworkSuccess: (() => void) | null = null;
  private onNetworkFailure: ((error: ApiNetworkError) => void) | null = null;
  private onApiVersion: ((version: number) => void) | null = null;
  private onSessionExpired: ExpiredHandler | null = null;
  private onPaymentRequired: PaymentRequiredHandler | null = null;
  private readonly failures = new RequestFailureCache();
  readonly request: OperationRequestFn;
  readonly requestResult: OperationRequestResultFn;
  readonly responseRequest: OperationResponseRequestFn;

  constructor(
    baseUrl?: string | null,
    private readonly instrumentation?: ApiRequestInstrumentation,
  ) {
    this.baseUrl = normalizeApiBaseUrl(baseUrl);
    bindPrototypeMethods(this, ApiRequestRuntime.prototype);
    this.request = this.makeRequest;
    this.requestResult = this.makeRequestResult;
    this.responseRequest = Object.assign(this.makeResponseRequest, {
      reportFailure: this.reportResponseRequestFailure,
      reportSuccess: (response: Response) => this.failures.success(response),
      sessionSignal: () => this.sessionRenewals.signal,
    });
  }

  /**
   * The bytes a login challenge is signed as, bound to the API this client
   * addresses. A relative base URL resolves against the page, as its requests
   * do; with neither, there is no API origin to sign for.
   */
  authChallengeBytes(challengeHex: string, fingerprint: string): Uint8Array {
    return sessionAuthChallengeBytes(this.baseUrl, challengeHex, fingerprint);
  }

  setOnError(handler: ((message: string) => void) | null): void {
    this.onError = handler;
  }

  /** Reports a failure carried inside a successful batched response. */
  reportError(message: string): void {
    this.onError?.(message);
  }

  setOnNetworkError(handler: (() => void) | null): void {
    this.onNetworkError = handler;
  }

  setOnNetworkSuccess(handler: (() => void) | null): void {
    this.onNetworkSuccess = handler;
  }

  /** Every fetch that threw without a response, except plain cancellations. */
  setOnNetworkFailure(handler: ((e: ApiNetworkError) => void) | null): void {
    this.onNetworkFailure = handler;
  }

  /** Receives the build named by each response that carries one. */
  setOnApiVersion(handler: ((version: number) => void) | null): void {
    this.onApiVersion = handler;
  }

  setOnSessionExpired(handler: ExpiredHandler | null): void {
    this.onSessionExpired = handler;
  }

  setOnPaymentRequired(handler: PaymentRequiredHandler | null): void {
    this.onPaymentRequired = handler;
  }

  setAuthToken(token: string | null, boundary?: SessionBoundary): boolean {
    const changed = Boolean(boundary) || this.authToken !== token;
    if (boundary) this.failures.clear();
    if (changed) this.sessionRenewals.tokenChanged(boundary);
    this.authToken = token;
    return changed;
  }

  captureCredential() {
    return this.sessionRenewals.captureCredential();
  }

  withSessionSignal(options: RequestResultOptions): RequestResultOptions {
    return this.sessionRenewals.withSessionSignal(options);
  }

  getAuthToken(): string | null {
    return this.authToken;
  }

  getRequestFailure(input: { method: HttpMethod; path: string }) {
    return this.failures.get(input);
  }

  private async makeRequest<T>(
    path: string,
    validator: (value: unknown) => value is T,
    method: HttpMethod,
    body: RequestBody | undefined,
    options: RequestResultOptions | undefined,
    failureOperation: Parameters<OperationRequestFn>[5],
  ): Promise<T | null> {
    const result = await this.makeRequestResult(
      path,
      validator,
      method,
      body,
      options,
      failureOperation,
    );
    return result.ok ? result.data : null;
  }

  private requestFailure(input: {
    code?: string | undefined;
    kind: RequestFailureKind;
    message: string;
    method: HttpMethod;
    networkError?: ApiNetworkError | undefined;
    path: string;
    reportErrors: boolean;
    requiredContainerIds?: RequestFailure["requiredContainerIds"];
    stalePrincipalHeads: RequestFailure["stalePrincipalHeads"];
    status: number | null;
    statusText: string;
  }): RequestFailure {
    const failure: RequestFailure = {
      ...(input.code === undefined ? {} : { code: input.code }),
      kind: input.kind,
      message: input.message,
      method: input.method,
      ...(input.networkError ? { networkError: input.networkError } : {}),
      ok: false,
      path: input.path,
      report: () => {
        if (input.kind !== "cancelled") this.onError?.(input.message);
      },
      status: input.status,
      statusText: input.statusText,
      ...(input.stalePrincipalHeads
        ? { stalePrincipalHeads: input.stalePrincipalHeads }
        : {}),
      ...(input.requiredContainerIds
        ? { requiredContainerIds: input.requiredContainerIds }
        : {}),
    };
    this.failures.record(failure);

    if (input.reportErrors) {
      failure.report();
    }

    return failure;
  }

  private async makeRequestResult<T>(
    path: string,
    validator: (value: unknown) => value is T,
    method: HttpMethod,
    body: RequestBody | undefined,
    options: RequestResultOptions | undefined,
    failureOperation: Parameters<OperationRequestFn>[5],
  ): Promise<RequestResult<T>> {
    const session = this.sessionRenewals.signal;
    const responseResult = await this.makeResponseRequest(
      path,
      method,
      body,
      options ?? {},
      [],
      failureOperation,
    );
    if (!responseResult.ok) {
      return responseResult;
    }

    const response = responseResult.data;
    const reportErrors = options?.reportErrors ?? true;
    const decoded = await readSessionJson(
      this.responseRequest,
      response,
      method,
      path,
      options ?? {},
      session,
    );
    if (responseRetired(session, options)) return retiredRequest(method, path);
    if (!decoded.ok) return decoded;
    const data = decoded.data;
    if (!validator(data)) {
      return this.requestFailure({
        kind: "shape",
        message: `Invalid response shape for ${path}`,
        method,
        path,
        reportErrors,
        stalePrincipalHeads: undefined,
        status: response.status,
        statusText: response.statusText,
      });
    }

    this.failures.success(response);
    return { data, ok: true };
  }
  private async makeResponseRequest(
    path: string,
    method: HttpMethod,
    body: RequestBody | undefined,
    options: RequestResultOptions,
    additionalSuccessStatuses: readonly number[],
    failureOperation: Parameters<OperationResponseRequestFn>[5],
    authToken = this.authToken,
    attempt = 1,
    observed = this.getRequestFailure({ method, path }),
  ): Promise<RequestResult<Response>> {
    const session = this.sessionRenewals.signal;
    const callerOptions = options;
    const waitOptions = this.sessionRenewals.withRenewalWaitSignal(options);
    options = this.sessionRenewals.withSessionSignal(options);
    const result = await this.fetchResponseRequest(
      path,
      method,
      body,
      options,
      authToken,
      failureOperation,
      attempt,
    );
    if (!result.ok) return result;
    const retired = (code?: string | null) =>
      retiredResponse(
        this.sessionRenewals.refused(session),
        method,
        path,
        result.data,
        code,
      );
    if (responseRetired(session, options)) return retired();
    const response = boundedMetadataResponse(result.data, options);
    if (isSuccessfulResponse(response, additionalSuccessStatuses))
      return this.failures.received(response, observed);
    const errorDescription = await describeErrorResponse(
      response,
      failureOperation,
      options.expectedPaymentRequiredOrganizationId,
    );
    options[resourceRequestActivity]?.finish();
    if (responseRetired(session, options))
      return retired(errorDescription.code);
    const failure = {
      errorDescription,
      failureOperation,
      method,
      options,
      path,
      response,
    };
    if (attempt === 2) return this.httpFailure(failure);

    // An independent replacement or caller cancellation ends this wait. A
    // refusal from the renewal itself must finish reporting its typed error.
    const shouldRetry = await shouldRetryAfterSessionExpired({
      authToken,
      body,
      code: errorDescription.code,
      getCurrentAuthToken: () => this.authToken,
      isKnownSessionRenewal: (from, to) =>
        this.sessionRenewals.isKnown(from, to),
      pendingSessionRenewal: (from) => this.sessionRenewals.pending(from),
      options: waitOptions,
      refreshSession: () => this.sessionRenewals.renew(this.onSessionExpired),
      reportError: (message) => this.onError?.(message),
      responseStatus: response.status,
    });
    if (responseRetired(session, options))
      return retired(errorDescription.code);
    const retryToken = this.sessionRenewals.currentToken(authToken);
    if (!shouldRetry || !retryToken) return this.httpFailure(failure);
    if (options.retryOnSessionExpired === "renew-only")
      return this.httpFailure({
        ...failure,
        options: {
          ...options,
          reportErrors: method === "GET" ? false : options.reportErrors,
        },
      });
    return this.makeResponseRequest(
      path,
      method,
      body,
      callerOptions,
      additionalSuccessStatuses,
      failureOperation,
      retryToken,
      2,
      observed,
    );
  }

  private async fetchResponseRequest(
    path: string,
    method: HttpMethod,
    body: RequestBody | undefined,
    options: RequestResultOptions,
    authToken: string | null,
    operation: Parameters<OperationResponseRequestFn>[5],
    /** 2 is the retry after a session renewal. */
    attempt = 1,
  ): Promise<RequestResult<Response>> {
    const session = this.sessionRenewals.signal;
    if (options.stillCurrent?.() === false) return retiredRequest(method, path);
    const { headers, init } = sessionRequestInit(
      method,
      body,
      options,
      authToken,
    );
    let response: Response;
    const startedAt = Date.now();
    try {
      response = await measureApiRequest(
        this.instrumentation,
        operation,
        () => fetch(`${this.baseUrl}${path}`, init),
        options.signal,
        options[resourceRequestActivity],
      );
    } catch (error) {
      if (requestRetired(session, options)) return retiredRequest(method, path);
      const { cancelled, networkError } = await settleNetworkFailure({
        attempt,
        baseUrl: this.baseUrl,
        elapsedMs: Date.now() - startedAt,
        error,
        headers,
        isOnline: this.instrumentation?.isOnline,
        method,
        onNetworkError: () => this.onNetworkError?.(),
        pathTemplate: operation.path,
        probe: this.instrumentation?.networkFailureProbe,
        signal: options.signal,
        onNetworkFailure: (failure) => this.onNetworkFailure?.(failure),
      });
      if (requestRetired(session, options)) return retiredRequest(method, path);
      return this.requestFailure({
        ...(cancelled ? { code: "request_aborted" } : {}),
        kind: cancelled ? "cancelled" : "network",
        message: `${method} ${path}: ${networkFailureMessage(error, networkError)}`,
        method,
        networkError,
        path,
        reportErrors: !cancelled && (options.reportErrors ?? true),
        stalePrincipalHeads: undefined,
        status: null,
        statusText: "",
      });
    }
    if (requestRetired(session, options))
      return retiredResponse(
        this.sessionRenewals.refused(session),
        method,
        path,
        response,
      );
    this.onNetworkSuccess?.();
    const apiVersion = parseApiVersion(
      response.headers.get(apiVersionHeaderName),
    );
    if (apiVersion !== null) this.onApiVersion?.(apiVersion);
    return { data: response, ok: true };
  }

  private httpFailure(input: {
    readonly errorDescription: ErrorResponseDescription;
    readonly failureOperation: Parameters<OperationResponseRequestFn>[5];
    readonly method: HttpMethod;
    readonly options: RequestResultOptions;
    readonly path: string;
    readonly response: Response;
  }): RequestFailure {
    const cancelled = input.options.signal?.aborted === true;
    const reportErrors = input.options.reportErrors ?? true;
    if (
      !cancelled &&
      input.response.status === 402 &&
      input.failureOperation.failureResponses?.[402] &&
      input.errorDescription.paymentRequiredOrganizationId !== undefined &&
      input.errorDescription.paymentRequiredOrganizationId ===
        input.options.expectedPaymentRequiredOrganizationId
    ) {
      this.onPaymentRequired?.(
        input.errorDescription.paymentRequiredOrganizationId,
      );
    }
    return this.requestFailure({
      ...(cancelled
        ? { code: "request_aborted" }
        : input.errorDescription.code === null
          ? {}
          : { code: input.errorDescription.code }),
      kind: cancelled ? "cancelled" : "http",
      message: `${input.method} ${input.path}: ${input.response.status} ${input.response.statusText}${input.errorDescription.detail}`,
      method: input.method,
      path: input.path,
      reportErrors: !cancelled && reportErrors,
      requiredContainerIds: input.errorDescription.requiredContainerIds,
      stalePrincipalHeads: input.errorDescription.stalePrincipalHeads,
      status: input.response.status,
      statusText: input.response.statusText,
    });
  }

  private reportResponseRequestFailure(
    input: ResponseRequestValidationFailureInput,
  ): RequestFailure {
    if (input.options?.stillCurrent?.() === false)
      return retiredRequest(input.method, input.path);
    if (input.kind === "network") {
      this.onNetworkError?.();
    }
    return this.requestFailure({
      ...input,
      reportErrors: input.options?.reportErrors ?? true,
      stalePrincipalHeads: undefined,
    });
  }
}
