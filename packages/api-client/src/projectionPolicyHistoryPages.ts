import { serializeKeyingCanonicalJson } from "@tearleads/crypto";
import {
  getProjectionPolicyHistoryOperation,
  operationRequestPathWithQuery,
} from "@tearleads/validators/operation";
import {
  isPrincipalPolicySnapshotPageResponse,
  type PrincipalPolicyHistorySourceResponse,
  PrincipalPolicyHistorySourceResponseSchema,
  type PrincipalPolicySnapshotPageResponse,
} from "@tearleads/validators/response";
import type { ApiRequestRuntime } from "./apiRequestRuntime";
import { principalHistoryRequest } from "./principalHistoryRequest";
import { PrincipalHistoryRequestContext } from "./principalHistoryRequestContext";
import type { RequestResult, RequestResultOptions } from "./types";

export interface ProjectionPolicyHistoryReadOptions
  extends RequestResultOptions {
  /** Only skip a prefix already authenticated by the caller. */
  readonly afterVersion?: number | undefined;
}

function validPage(
  page: PrincipalPolicySnapshotPageResponse,
  source: PrincipalPolicyHistorySourceResponse,
  after: number,
): boolean {
  const head = source.head;
  const state = page.currentState;
  const through = after + page.previousStates.length;
  return (
    state.principalType === head.principalType &&
    state.principalId === head.principalId &&
    state.version === head.version &&
    state.stateHash === head.stateHash &&
    state.keyEpoch === head.keyEpoch &&
    state.keyFingerprint === head.keyFingerprint &&
    page.historyPage.afterVersion === after &&
    through < head.version &&
    page.previousStates.every(
      ({ state: entry }, index) =>
        entry.version === after + index + 1 &&
        entry.principalType === head.principalType &&
        entry.principalId === head.principalId,
    ) &&
    (page.historyPage.nextAfterVersion === null
      ? through === head.version - 1
      : through > after &&
        through < head.version - 1 &&
        page.historyPage.nextAfterVersion === through)
  );
}

/** One bounded public page at a time. Only the caller authenticates its contents. */
export async function* readProjectionPolicyHistoryPages(
  runtime: ApiRequestRuntime,
  input: PrincipalPolicyHistorySourceResponse,
  options: ProjectionPolicyHistoryReadOptions = {},
): AsyncGenerator<RequestResult<PrincipalPolicySnapshotPageResponse>, void> {
  const parsed = PrincipalPolicyHistorySourceResponseSchema.safeParse(input);
  let afterVersion = options.afterVersion ?? 0;
  const invalid = (message: string, status: number | null = null) =>
    runtime.responseRequest.reportFailure({
      kind: "shape",
      message,
      method: "GET",
      options,
      path: "/principals/history",
      status,
      statusText: "",
    });
  if (
    !parsed.success ||
    !Number.isSafeInteger(afterVersion) ||
    afterVersion < 0 ||
    afterVersion >= parsed.data.head.version
  ) {
    yield invalid("Invalid projection history source or cursor");
    return;
  }
  const source = structuredClone(parsed.data);
  const context = new PrincipalHistoryRequestContext(
    runtime,
    "GET",
    "/principals/history",
    options,
  );
  let pinnedBytes: string | undefined;
  while (true) {
    const path = operationRequestPathWithQuery(
      getProjectionPolicyHistoryOperation,
      {},
      { grant: source.grant, afterVersion },
    );
    const result = await principalHistoryRequest(runtime, {
      path,
      validator: isPrincipalPolicySnapshotPageResponse,
      method: "GET",
      operation: getProjectionPolicyHistoryOperation,
      options,
      context,
    });
    if (!result.ok) {
      yield result;
      return;
    }
    const page = result.data;
    const bytes = serializeKeyingCanonicalJson({
      currentState: page.currentState,
      currentProjection: page.currentProjection,
      currentGrants: page.currentGrants,
    });
    if (
      !validPage(page, source, afterVersion) ||
      (pinnedBytes !== undefined && bytes !== pinnedBytes)
    ) {
      yield invalid(
        "Projection history page changed its head, order, or cursor",
        200,
      );
      return;
    }
    pinnedBytes ??= bytes;
    context.afterReadPage();
    const next = page.historyPage.nextAfterVersion;
    yield result;
    if (context.cancelled()) {
      yield context.failure();
      return;
    }
    if (next === null) return;
    afterVersion = next;
  }
}
