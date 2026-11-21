import { serializeKeyingCanonicalJson } from "@tearleads/crypto";
import {
  getProjectionPolicyHistoryOperation,
  operationRequestPathWithQuery,
} from "@tearleads/validators/operation";
import {
  isPrincipalPolicySnapshotPageResponse,
  type PrincipalPolicyHistorySourceResponse,
  type PrincipalPolicySnapshotPage,
  type PrincipalStateResponse,
} from "@tearleads/validators/response";
import type { ApiRequestRuntime } from "./apiRequestRuntime";
import {
  projectionHistoryPageWithCurrent,
  readProjectionHistoryStart,
  validProjectionHistoryPage,
} from "./policyHistoryPageChecks";
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

/** One bounded public page at a time. Only the caller authenticates its contents. */
export async function* readProjectionPolicyHistoryPages(
  runtime: ApiRequestRuntime,
  input: PrincipalPolicyHistorySourceResponse,
  options: ProjectionPolicyHistoryReadOptions = {},
  // Default parameters run when the iterator is created, before its first pull.
  identity = PrincipalHistoryRequestContext.captureIdentity(runtime),
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
  const start = readProjectionHistoryStart(input, options);
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
    identity,
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
    const page = projectionHistoryPageWithCurrent(
      result.data,
      knownCurrentState,
    );
    const bytes =
      page &&
      serializeKeyingCanonicalJson({
        currentState: page.currentState,
        currentProjection: page.currentProjection,
        currentGrants: page.currentGrants,
      });
    if (
      !page ||
      !validProjectionHistoryPage(page, source, afterVersion) ||
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
