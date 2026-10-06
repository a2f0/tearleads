import type { ApiRequestRuntime } from "./apiRequestRuntime";
import type { HttpMethod, RequestFailure, RequestResultOptions } from "./types";

/** Keep continuations within their authentication context without hiding commit uncertainty. */
export class PrincipalHistoryRequestContext {
  readonly options: RequestResultOptions;
  private token: string | null;
  private submitted = false;
  private renewedRead = false;
  private restartedRead = false;

  constructor(
    private readonly runtime: ApiRequestRuntime,
    private readonly method: HttpMethod,
    private readonly path: string,
    options: RequestResultOptions | undefined,
  ) {
    this.token = runtime.getAuthToken();
    this.options = {
      ...options,
      retryOnSessionExpired:
        options?.retryOnSessionExpired === false ? false : "renew-only",
      onSessionRenewed: () => {
        if (method === "GET" && !options?.signal?.aborted) {
          this.token = runtime.getAuthToken();
          this.renewedRead = true;
        }
      },
    };
  }

  cancelled(): boolean {
    return (
      this.options.signal?.aborted === true ||
      this.runtime.getAuthToken() !== this.token
    );
  }

  beforeRequest(): void {
    this.submitted = this.method !== "GET";
  }

  afterPreparation(): void {
    this.submitted = false;
  }

  afterReadPage(): void {
    // A completed page is forward progress. A later page may renew again,
    // while repeated 401s within one page still cannot loop indefinitely.
    this.renewedRead = false;
    this.restartedRead = false;
  }

  restartReadAfterRenewal(): boolean {
    if (!this.renewedRead || this.restartedRead || this.cancelled())
      return false;
    this.restartedRead = true;
    return true;
  }

  failure(response?: Response, timedOut = false): RequestFailure {
    void response?.body?.cancel().catch(() => {});
    return this.runtime.responseRequest.reportFailure({
      code: this.submitted
        ? "principal_history_outcome_unknown"
        : timedOut
          ? "principal_history_request_timed_out"
          : "principal_history_context_changed",
      kind: this.submitted ? "outcome-unknown" : "cancelled",
      message: this.submitted
        ? "Policy request may have committed; refresh before retrying"
        : timedOut
          ? "Principal history request timed out"
          : "Principal history request was cancelled",
      method: this.method,
      options: { ...this.options, reportErrors: false },
      path: this.path,
      status: null,
      statusText: "",
    });
  }
}
