/**
 * A sync lane's lifecycle as two orthogonal machines. The run says who owns
 * the lane's callback; the request says whether another pass is owed. A
 * request may be pending in every run phase: one arriving during a run is
 * coalesced and survives that run's settlement (docs/client-sync-ordering.md).
 * Tags (`token`, `notBeforeAtMs`) let only the run, watchdog verdict, backoff
 * timer, or delay timer that is still current move its machine.
 */

export type SyncLaneRun =
  | { readonly status: "idle" }
  // An observational upload session. It shows the lane as running but owns
  // no callback, so the pump may still start a lane registered on its key.
  | { readonly status: "uploading"; readonly token: object }
  | { readonly status: "running"; readonly token: object }
  // The watchdog stopped waiting, but the callback still owns the lane until
  // it settles, so the lane can never run concurrently with itself.
  | { readonly status: "abandoned"; readonly token: object }
  // A settled failure with a trailing request cools down before rerunning.
  | { readonly status: "backingOff"; readonly token: object };

export type SyncLaneRunEvent =
  | { readonly type: "start"; readonly token: object }
  // A re-begun upload replaces the previous session; pump phases keep the lane.
  | { readonly type: "upload-start"; readonly token: object }
  | { readonly type: "settle"; readonly token: object }
  | { readonly type: "time-out"; readonly token: object }
  | { readonly type: "back-off"; readonly token: object }
  | { readonly type: "backoff-expire"; readonly token: object };

export type SyncLaneRequest =
  | { readonly status: "none" }
  | { readonly status: "queued" }
  | { readonly status: "delayed"; readonly notBeforeAtMs: number };

export type SyncLaneRequestEvent =
  | { readonly type: "request" }
  | { readonly type: "request-after"; readonly notBeforeAtMs: number }
  | { readonly type: "delay-elapse"; readonly notBeforeAtMs: number }
  // A run takes the request, dispose drops it, an upload row never has one.
  | { readonly type: "clear" };

export const IDLE_SYNC_LANE_RUN: SyncLaneRun = { status: "idle" };
export const NO_SYNC_LANE_REQUEST: SyncLaneRequest = { status: "none" };
const QUEUED_SYNC_LANE_REQUEST: SyncLaneRequest = { status: "queued" };

function assertNever(value: never): never {
  throw new Error(`Unhandled sync lane event: ${JSON.stringify(value)}`);
}

function ownsToken(run: SyncLaneRun, token: object): boolean {
  return run.status !== "idle" && run.token === token;
}

export function transitionSyncLaneRun(
  run: SyncLaneRun,
  event: SyncLaneRunEvent,
): SyncLaneRun {
  switch (event.type) {
    case "start":
      return run.status === "idle" || run.status === "uploading"
        ? { status: "running", token: event.token }
        : run;
    case "upload-start":
      return run.status === "idle" || run.status === "uploading"
        ? { status: "uploading", token: event.token }
        : run;
    case "settle":
      return run.status !== "backingOff" && ownsToken(run, event.token)
        ? IDLE_SYNC_LANE_RUN
        : run;
    case "time-out":
      return run.status === "running" && ownsToken(run, event.token)
        ? { status: "abandoned", token: event.token }
        : run;
    case "back-off":
      return run.status === "idle"
        ? { status: "backingOff", token: event.token }
        : run;
    case "backoff-expire":
      return run.status === "backingOff" && ownsToken(run, event.token)
        ? IDLE_SYNC_LANE_RUN
        : run;
    default:
      return assertNever(event);
  }
}

export function transitionSyncLaneRequest(
  request: SyncLaneRequest,
  event: SyncLaneRequestEvent,
): SyncLaneRequest {
  switch (event.type) {
    case "request":
      return request.status === "queued" ? request : QUEUED_SYNC_LANE_REQUEST;
    case "request-after":
      if (request.status === "queued") return request;
      if (
        request.status === "delayed" &&
        request.notBeforeAtMs <= event.notBeforeAtMs
      ) {
        return request;
      }
      return { status: "delayed", notBeforeAtMs: event.notBeforeAtMs };
    case "delay-elapse":
      return request.status === "delayed" &&
        request.notBeforeAtMs === event.notBeforeAtMs
        ? QUEUED_SYNC_LANE_REQUEST
        : request;
    case "clear":
      return request.status === "none" ? request : NO_SYNC_LANE_REQUEST;
    default:
      return assertNever(event);
  }
}

/** A live callback (running or abandoned) still owns the lane. */
export function ownsLiveRun(run: SyncLaneRun): boolean {
  return run.status === "running" || run.status === "abandoned";
}

/** Only an idle or upload-only lane may start a pump run. */
export function canStartRun(run: SyncLaneRun): boolean {
  return run.status === "idle" || run.status === "uploading";
}

/** What snapshots report as `running`: a pump run or an upload session. */
export function isRunActive(run: SyncLaneRun): boolean {
  return run.status === "running" || run.status === "uploading";
}

export function hasPendingRequest(request: SyncLaneRequest): boolean {
  return request.status !== "none";
}

export function isRequestDue(request: SyncLaneRequest, nowMs: number): boolean {
  return (
    request.status === "queued" ||
    (request.status === "delayed" && request.notBeforeAtMs <= nowMs)
  );
}
