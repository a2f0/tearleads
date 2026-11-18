import {
  apiVersionHeaderName,
  parseApiVersion,
} from "@tearleads/validators/operation";
import type { ApiRequestInstrumentation } from "./apiRequestMetrics";
import { measureApiRequest } from "./measureApiRequest";
import {
  type ApiNetworkError,
  networkFailureMessage,
  settleNetworkFailure,
} from "./networkFailure";
import {
  bindPrototypeMethods,
  describeErrorResponse,
  type ErrorResponseDescription,
  isSuccessfulResponse,
  normalizeApiBaseUrl,
  requestFailureKey,
} from "./requestInternals";
import { shouldRetryAfterSessionExpired } from "./sessionRefresh";
import {
  SessionRenewalTracker,
  sessionAuthChallengeBytes,
} from "./sessionRenewal";
import { sessionRequestInit } from "./sessionRequestInit";
import { readSessionJson, retiredRequest } from "./sessionResponse";
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
  private readonly requestFailuresByKey = new Map<string, RequestFailure>();
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

  setAuthToken(token: string | null, newSession = false): boolean {
    const changed = newSession || this.authToken !== token;
    if (newSession) this.requestFailuresByKey.clear();
    if (changed) this.sessionRenewals.tokenChanged(newSession);
    this.authToken = token;
    return changed;
  }

  getAuthToken(): string | null {
    return this.authToken;
  }

  getRequestFailure(input: { method: HttpMethod; path: string }) {
    return this.requestFailuresByKey.get(requestFailureKey(input)) ?? null;
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
    if (session.aborted) return retiredRequest(method, path);
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
  ): Promise<RequestResult<Response>> {
    const session = this.sessionRenewals.signal;
    const callerOptions = options;
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
    if (session.aborted) return retiredRequest(method, path);
    if (!result.ok) return result;
    const response = result.data;
    if (isSuccessfulResponse(response, additionalSuccessStatuses)) {
      this.requestFailuresByKey.delete(requestFailureKey({ method, path }));
      return result;
    }
    const errorDescription = await describeErrorResponse(
      response,
      failureOperation,
      options.expectedPaymentRequiredOrganizationId,
    );
    if (session.aborted) return retiredRequest(method, path);
    const failure = {
      errorDescription,
      failureOperation,
      method,
      options,
      path,
      response,
    };
    if (attempt === 2) return this.httpFailure(failure);

    // The renewal itself may reject and sign out. Only caller cancellation
    // ends that wait early, so a signed-out refusal keeps its typed error.
    const shouldRetry = await shouldRetryAfterSessionExpired({
      authToken,
      body,
      code: errorDescription.code,
      getCurrentAuthToken: () => this.authToken,
      isKnownSessionRenewal: (from, to) =>
        this.sessionRenewals.isKnown(from, to),
      pendingSessionRenewal: (from) => this.sessionRenewals.pending(from),
      options: callerOptions,
      refreshSession: () => this.sessionRenewals.renew(this.onSessionExpired),
      reportError: (message) => this.onError?.(message),
      responseStatus: response.status,
    });
    if (session.aborted) return retiredRequest(method, path);
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
    const reportErrors = options.reportErrors ?? true;
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
      );
    } catch (error) {
      if (session.aborted) return retiredRequest(method, path);
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
      if (session.aborted) return retiredRequest(method, path);
      return this.requestFailure({
        ...(cancelled ? { code: "request_aborted" } : {}),
        kind: cancelled ? "cancelled" : "network",
        message: `${method} ${path}: ${networkFailureMessage(error, networkError)}`,
        method,
        networkError,
        path,
        reportErrors: cancelled ? false : reportErrors,
        stalePrincipalHeads: undefined,
        status: null,
        statusText: "",
      });
    }

    if (session.aborted) return retiredRequest(method, path);
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
