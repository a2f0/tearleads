import { requestFailureKey } from "./requestInternals";
import type { HttpMethod, RequestFailure } from "./types";

type RequestPath = { method: HttpMethod; path: string };
interface PathRequests {
  dispatched: number;
  settled: number;
}
export interface RequestDispatch {
  readonly key: string;
  readonly requests: PathRequests;
  readonly sequence: number;
}

/** Keep the newest dispatched outcome that has actually finished validating. */
export class RequestFailureCache {
  private readonly failures = new Map<string, RequestFailure>();
  // Only overlapping requests need to share ordering. Raw response consumers
  // can discard a Response without running a decoder or reporting an outcome.
  private readonly paths = new Map<string, WeakRef<PathRequests>>();
  private readonly responses = new WeakMap<Response, RequestDispatch>();
  private readonly abandoned = new FinalizationRegistry<string>((key) => {
    if (!this.paths.get(key)?.deref()) this.paths.delete(key);
  });

  begin(request: RequestPath): RequestDispatch {
    const key = requestFailureKey(request);
    let requests = this.paths.get(key)?.deref();
    if (!requests) {
      requests = { dispatched: 0, settled: 0 };
      this.paths.set(key, new WeakRef(requests));
      this.abandoned.register(requests, key);
    }
    return { key, requests, sequence: ++requests.dispatched };
  }

  private settle({ key, requests, sequence }: RequestDispatch) {
    if (
      this.paths.get(key)?.deref() !== requests ||
      requests.settled > sequence
    )
      return false;
    requests.settled = sequence;
    return true;
  }

  get(request: RequestPath) {
    return this.failures.get(requestFailureKey(request)) ?? null;
  }

  record(failure: RequestFailure, dispatch = this.begin(failure)) {
    if (this.settle(dispatch)) this.failures.set(dispatch.key, failure);
  }

  clear() {
    this.paths.clear();
    this.failures.clear();
  }

  received(response: Response, dispatch: RequestDispatch) {
    this.responses.set(response, dispatch);
    return { ok: true as const, data: response };
  }

  dispatchFor(response: Response) {
    return this.responses.get(response);
  }

  success(response: Response) {
    const dispatch = this.dispatchFor(response);
    if (dispatch && this.settle(dispatch)) this.failures.delete(dispatch.key);
  }
}
