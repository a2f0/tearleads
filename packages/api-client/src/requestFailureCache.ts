import { requestFailureKey } from "./requestInternals";
import type { HttpMethod, RequestFailure } from "./types";

/** A valid response clears only a failure observed before that request started. */
export class RequestFailureCache {
  private readonly failures = new Map<string, RequestFailure>();
  private readonly observed = new WeakMap<Response, RequestFailure>();

  get(request: { method: HttpMethod; path: string }) {
    return this.failures.get(requestFailureKey(request)) ?? null;
  }

  record(failure: RequestFailure, observed: RequestFailure | null = null) {
    // Record a caller's cancellation unless another request reported a failure since dispatch.
    if (failure.kind !== "cancelled" || this.get(failure) === observed)
      this.failures.set(requestFailureKey(failure), failure);
  }

  clear() {
    this.failures.clear();
  }

  received(response: Response, observed: RequestFailure | null) {
    if (observed) this.observed.set(response, observed);
    return { ok: true as const, data: response };
  }

  success(response: Response) {
    const failure = this.observed.get(response);
    if (failure && this.get(failure) === failure)
      this.failures.delete(requestFailureKey(failure));
  }
}
