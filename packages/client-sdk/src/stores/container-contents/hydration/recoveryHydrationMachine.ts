/**
 * Recovery hydration for one store: requests queue while their crawl cannot
 * run, and one resume takes the whole queue over as one run. A request queued
 * while a run is in flight waits for the next resume. A caller whose queued
 * request another caller already took over settles with that run, so it never
 * resolves before the crawl that covers it.
 *
 * | state               | event   | next                             |
 * | ------------------- | ------- | -------------------------------- |
 * | idle                | queued  | queued([request])                |
 * | queued              | queued  | queued(+request, once per input) |
 * | running             | queued  | running-with-queued(run, [req])  |
 * | running-with-queued | queued  | running-with-queued(+request)    |
 * | queued              | started | running(run)                     |
 * | running-with-queued | started | running(new run)                 |
 * | running             | settled | idle (current run only)          |
 * | running-with-queued | settled | queued(requests) (current only)  |
 *
 * `started` with nothing queued and `settled` for a stale run are ignored.
 */
export type RecoveryHydrationState<TRequest> =
  | { readonly status: "idle" }
  | { readonly status: "queued"; readonly requests: readonly TRequest[] }
  | { readonly status: "running"; readonly run: Promise<void> }
  | {
      readonly status: "running-with-queued";
      readonly requests: readonly TRequest[];
      readonly run: Promise<void>;
    };

export type RecoveryHydrationEvent<TRequest> =
  | { readonly type: "queued"; readonly request: TRequest }
  | { readonly type: "started"; readonly run: Promise<void> }
  | { readonly type: "settled"; readonly run: Promise<void> };

export const IDLE_RECOVERY_HYDRATION = { status: "idle" } as const;

/** A request is queued once per input, however often it is retained. */
function withRequest<TRequest extends { readonly input: unknown }>(
  requests: readonly TRequest[],
  request: TRequest,
): readonly TRequest[] {
  return requests.some((queued) => queued.input === request.input)
    ? requests
    : [...requests, request];
}

export function transitionRecoveryHydration<
  TRequest extends { readonly input: unknown },
>(
  state: RecoveryHydrationState<TRequest>,
  event: RecoveryHydrationEvent<TRequest>,
): RecoveryHydrationState<TRequest> {
  switch (event.type) {
    case "queued":
      switch (state.status) {
        case "idle":
          return { requests: [event.request], status: "queued" };
        case "queued":
          return {
            requests: withRequest(state.requests, event.request),
            status: "queued",
          };
        case "running":
          return {
            requests: [event.request],
            run: state.run,
            status: "running-with-queued",
          };
        case "running-with-queued":
          return {
            requests: withRequest(state.requests, event.request),
            run: state.run,
            status: "running-with-queued",
          };
        default:
          return assertNever(state);
      }
    case "started":
      return state.status === "queued" || state.status === "running-with-queued"
        ? { run: event.run, status: "running" }
        : state;
    case "settled":
      if (state.status === "running" && state.run === event.run) {
        return IDLE_RECOVERY_HYDRATION;
      }
      if (state.status === "running-with-queued" && state.run === event.run) {
        return { requests: state.requests, status: "queued" };
      }
      return state;
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(
    `Unhandled recovery hydration value: ${JSON.stringify(value)}`,
  );
}
