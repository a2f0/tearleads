import {
  describeErrorResponse,
  type ErrorResponseDescription,
  errorMessage,
  hasHeader,
  isRefreshableSessionError,
  isReplayableRequestBody,
  normalizeApiBaseUrl,
} from "./requestInternals";
import type {
  HttpMethod,
  RequestBody,
  RequestFailure,
  RequestFailureKind,
  RequestResult,
  RequestResultOptions,
  ResponseRequestValidationFailureInput,
} from "./types";

type ExpiredHandler = () => boolean | Promise<boolean>;

/**
 * HTTP transport for the API client: header building, fetch, response-shape
 * validation, error/failure mapping, and single-retry-after-session-refresh.
 * Owns the auth token and network/error callbacks so `ApiClient` stays a thin
 * route-delegation surface over this layer.
 */
export class ApiTransport {
  private authToken: string | null = null;
  private readonly baseUrl: string;
  private onError: ((message: string) => void) | null = null;
  private onNetworkError: (() => void) | null = null;
  private onNetworkSuccess: (() => void) | null = null;
  private onSessionExpired: ExpiredHandler | null = null;

  constructor(baseUrl?: string | null) {
    this.baseUrl = normalizeApiBaseUrl(baseUrl);
    this.makeRequest = this.makeRequest.bind(this);
    this.makeRequestResult = this.makeRequestResult.bind(this);
    this.makeResponseRequest = this.makeResponseRequest.bind(this);
    this.reportResponseRequestFailure =
      this.reportResponseRequestFailure.bind(this);
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

  /**
   * Updates the bearer token. Returns true when the token actually changed, so
   * the caller can invalidate auth-scoped caches.
   */
  setAuthToken(token: string | null): boolean {
    const changed = this.authToken !== token;
    this.authToken = token;
    return changed;
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

  async makeRequest<T>(
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

  async makeRequestResult<T>(
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

  async makeResponseRequest(
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

  reportResponseRequestFailure(
    input: ResponseRequestValidationFailureInput,
  ): RequestFailure {
    return this.requestFailure({
      ...input,
      reportErrors: input.options?.reportErrors ?? true,
      stalePrincipalPolicies: undefined,
    });
  }
}
