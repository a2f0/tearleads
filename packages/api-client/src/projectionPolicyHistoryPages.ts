import { serializeKeyingCanonicalJson } from "@tearleads/crypto";
import {
  getProjectionPolicyHistoryOperation,
  operationRequestPathWithQuery,
} from "@tearleads/validators/operation";
import {
  isPrincipalPolicySnapshotPageResponse,
  isPrincipalStateResponse,
  type PrincipalPolicyHistorySourceResponse,
  PrincipalPolicyHistorySourceResponseSchema,
  type PrincipalPolicySnapshotPage,
  type PrincipalPolicySnapshotPageResponse,
  type PrincipalStateResponse,
} from "@tearleads/validators/response";
import type { ApiRequestRuntime } from "./apiRequestRuntime";
import { principalHistoryRequest } from "./principalHistoryRequest";
import { PrincipalHistoryRequestContext } from "./principalHistoryRequestContext";
import type { RequestResult, RequestResultOptions } from "./types";

export interface ProjectionPolicyHistoryReadOptions
  extends RequestResultOptions {
  /** Only skip a prefix already authenticated by the caller. */
  readonly afterVersion?: number | undefined;
  /**
   * A signed state the caller holds for exactly the source head. The server
   * then omits its copy and every page carries this one; the caller verifies
   * it as it would a served state.
   */
  readonly knownCurrentState?: PrincipalStateResponse | undefined;
}

function matchesHead(
  state: PrincipalStateResponse,
  head: PrincipalPolicyHistorySourceResponse["head"],
): boolean {
  return (
    state.principalType === head.principalType &&
    state.principalId === head.principalId &&
    state.version === head.version &&
    state.stateHash === head.stateHash &&
    state.keyEpoch === head.keyEpoch &&
    state.keyFingerprint === head.keyFingerprint
  );
}

/** A held state replaces only an explicit omission; a served one must be absent from the request. */
function currentPage(
  page: PrincipalPolicySnapshotPageResponse,
  known: PrincipalStateResponse | undefined,
): PrincipalPolicySnapshotPage | undefined {
  if (known) {
    return page.currentState === null
      ? { ...page, currentState: structuredClone(known) }
      : undefined;
  }
  const currentState = page.currentState;
  return currentState === null ? undefined : { ...page, currentState };
}

function validPage(
  page: PrincipalPolicySnapshotPage,
  source: PrincipalPolicyHistorySourceResponse,
  after: number,
): boolean {
  const head = source.head;
  const through = after + page.previousStates.length;
  return (
    matchesHead(page.currentState, head) &&
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

/** Owned copies of a valid source, cursor and held head, or undefined. */
function readStart(
  input: PrincipalPolicyHistorySourceResponse,
  options: ProjectionPolicyHistoryReadOptions,
) {
  const parsed = PrincipalPolicyHistorySourceResponseSchema.safeParse(input);
  const afterVersion = options.afterVersion ?? 0;
  const known = options.knownCurrentState;
  if (
    !parsed.success ||
    !Number.isSafeInteger(afterVersion) ||
    afterVersion < 0 ||
    afterVersion >= parsed.data.head.version ||
    (known !== undefined &&
      (!isPrincipalStateResponse(known) ||
        !matchesHead(known, parsed.data.head)))
  )
    return undefined;
  return {
    source: structuredClone(parsed.data),
    afterVersion,
    knownCurrentState: known && structuredClone(known),
  };
}

/** One bounded public page at a time. Only the caller authenticates its contents. */
export async function* readProjectionPolicyHistoryPages(
  runtime: ApiRequestRuntime,
  input: PrincipalPolicyHistorySourceResponse,
  options: ProjectionPolicyHistoryReadOptions = {},
): AsyncGenerator<RequestResult<PrincipalPolicySnapshotPage>, void> {
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
  const start = readStart(input, options);
  if (!start) {
    yield invalid("Invalid projection history source or cursor");
    return;
  }
  const { source, knownCurrentState } = start;
  let afterVersion = start.afterVersion;
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
      {
        grant: source.grant,
        afterVersion,
        ...(knownCurrentState
          ? { knownStateHash: knownCurrentState.stateHash }
          : {}),
      },
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
    const page = currentPage(result.data, knownCurrentState);
    const bytes =
      page &&
      serializeKeyingCanonicalJson({
        currentState: page.currentState,
        currentProjection: page.currentProjection,
        currentGrants: page.currentGrants,
      });
    if (
      !page ||
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
    yield { ...result, data: page };
    if (context.cancelled()) {
      yield context.failure();
      return;
    }
    if (next === null) return;
    afterVersion = next;
  }
}
