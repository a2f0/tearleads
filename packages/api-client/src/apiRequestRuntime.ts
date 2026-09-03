import {
  bindPrototypeMethods,
  describeErrorResponse,
  type ErrorResponseDescription,
  errorMessage,
  hasHeader,
  isSuccessfulResponse,
  normalizeApiBaseUrl,
  requestFailureKey,
} from "./requestInternals";
import { shouldRetryAfterSessionExpired } from "./sessionRefresh";
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
  private readonly baseUrl: string;
  private onError: ((message: string) => void) | null = null;
  private onNetworkError: (() => void) | null = null;
  private onNetworkSuccess: (() => void) | null = null;
  private onSessionExpired: ExpiredHandler | null = null;
  private onPaymentRequired: PaymentRequiredHandler | null = null;
  private readonly requestFailuresByKey = new Map<string, RequestFailure>();
  readonly request: OperationRequestFn;
  readonly requestResult: OperationRequestResultFn;
  readonly responseRequest: OperationResponseRequestFn;

  constructor(baseUrl?: string | null) {
    this.baseUrl = normalizeApiBaseUrl(baseUrl);
    bindPrototypeMethods(this, ApiRequestRuntime.prototype);
    this.request = this.makeRequest;
    this.requestResult = this.makeRequestResult;
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

  setOnSessionExpired(handler: ExpiredHandler | null): void {
    this.onSessionExpired = handler;
  }

  setOnPaymentRequired(handler: PaymentRequiredHandler | null): void {
    this.onPaymentRequired = handler;
  }

  setAuthToken(token: string | null): boolean {
    const changed = this.authToken !== token;
    this.authToken = token;
    return changed;
  }

  getAuthToken(): string | null {
    return this.authToken;
  }

  getRequestFailure(input: { method: HttpMethod; path: string }) {
    return this.requestFailuresByKey.get(requestFailureKey(input)) ?? null;
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
    path: string;
    reportErrors: boolean;
    stalePrincipalPolicies: RequestFailure["stalePrincipalPolicies"];
    status: number | null;
    statusText: string;
  }): RequestFailure {
    const failure: RequestFailure = {
      ...(input.code === undefined ? {} : { code: input.code }),
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
    body: RequestBody | undefined,
    options: RequestResultOptions = {},
    failureOperation: Parameters<OperationRequestFn>[5],
  ): Promise<RequestResult<T>> {
    const responseResult = await this.makeResponseRequest(
      path,
      method,
      body,
      options,
      [],
      failureOperation,
    );
    if (!responseResult.ok) {
      return responseResult;
    }

    const response = responseResult.data;
    const reportErrors = options.reportErrors ?? true;
    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      return this.requestFailure({
        kind: "json",
        message: `${method} ${path}: failed to parse JSON: ${errorMessage(error)}`,
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
    body: RequestBody | undefined,
    options: RequestResultOptions = {},
    additionalSuccessStatuses: readonly number[],
    failureOperation: Parameters<OperationResponseRequestFn>[5],
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
    const response = responseResult.data;
    if (isSuccessfulResponse(response, additionalSuccessStatuses)) {
      this.requestFailuresByKey.delete(requestFailureKey({ method, path }));
      return { data: response, ok: true };
    }

    const errorDescription = await describeErrorResponse(
      response,
      failureOperation,
      options.expectedPaymentRequiredOrganizationId,
    );
    if (
      await shouldRetryAfterSessionExpired({
        authToken,
        body,
        code: errorDescription.code,
        getCurrentAuthToken: () => this.authToken,
        options,
        refreshSession: () => this.onSessionExpired?.() ?? false,
        reportError: (message) => this.onError?.(message),
        responseStatus: response.status,
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
      const retryResponse = retryResult.data;
      if (isSuccessfulResponse(retryResponse, additionalSuccessStatuses)) {
        this.requestFailuresByKey.delete(requestFailureKey({ method, path }));
        return { data: retryResponse, ok: true };
      }

      return this.httpFailure({
        errorDescription: await describeErrorResponse(
          retryResponse,
          failureOperation,
          options.expectedPaymentRequiredOrganizationId,
        ),
        failureOperation,
        method,
        options,
        path,
        response: retryResponse,
      });
    }

    return this.httpFailure({
      errorDescription,
      failureOperation,
      method,
      options,
      path,
      response,
    });
  }

  private async fetchResponseRequest(
    path: string,
    method: HttpMethod,
    body: RequestBody | undefined,
    options: RequestResultOptions,
    authToken: string | null,
  ): Promise<RequestResult<Response>> {
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
    } catch (error) {
      this.onNetworkError?.();
      return this.requestFailure({
        kind: "network",
        message: `${method} ${path}: ${errorMessage(error)}`,
        method,
        path,
        reportErrors,
        stalePrincipalPolicies: undefined,
        status: null,
        statusText: "",
      });
    }

    this.onNetworkSuccess?.();
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
    const reportErrors = input.options.reportErrors ?? true;
    if (
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
      ...(input.errorDescription.code === null
        ? {}
        : { code: input.errorDescription.code }),
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

  private reportResponseRequestFailure(
    input: ResponseRequestValidationFailureInput,
  ): RequestFailure {
    return this.requestFailure({
      ...input,
      reportErrors: input.options?.reportErrors ?? true,
      stalePrincipalPolicies: undefined,
    });
  }
}
