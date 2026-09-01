import { expect } from "bun:test";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { act } from "@testing-library/react";
import {
  type AppTestSyncLaneErrorBaseline,
  captureAppTestSyncLaneErrorBaseline,
  listAppTestSyncLaneErrorsSince,
  waitForAppTestRuntimeToSettle,
} from "../appRuntimeIdle";
import {
  type ProxiedApiRequest,
  requestPath,
  summarizeProxiedApiRequests,
  truncateText,
} from "../dualPaneRequestSummary";
import { listProxiedApiRequests } from "../mswServer";
import { waitForCondition } from "../waitForCondition";
import {
  DUAL_PANE_TEST_TIMEOUT_MS,
  POST_SHARE_NETWORK_IDLE_QUIET_MS,
  POST_SHARE_SYNC_SETTLE_TIMEOUT_MS,
} from "./dualPaneCore";

interface PostShareSyncBaseline {
  readonly requestStartIndex: number;
  readonly syncLaneErrors: AppTestSyncLaneErrorBaseline;
}

export function capturePostShareSyncBaseline(): PostShareSyncBaseline {
  return {
    requestStartIndex: listProxiedApiRequests().length,
    syncLaneErrors: captureAppTestSyncLaneErrorBaseline(),
  };
}

interface BlobAttachmentBindingJson {
  bindingId?: unknown;
  blobId?: unknown;
}

function parseBlobAttachmentBindingJson(
  body: string,
): BlobAttachmentBindingJson | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as BlobAttachmentBindingJson)
      : null;
  } catch {
    return null;
  }
}

function isSuccessfulBlobAttachmentBinding(
  request: ProxiedApiRequest,
): boolean {
  if (
    request.method !== "POST" ||
    request.status !== 200 ||
    !/^\/blobs\/[^/]+\/attachment-bindings$/u.test(requestPath(request.url))
  ) {
    return false;
  }

  const response = parseBlobAttachmentBindingJson(request.responseBody);
  return (
    typeof response?.blobId === "string" &&
    typeof response.bindingId === "string"
  );
}

export async function waitForRemoteAttachmentBlob() {
  await waitForCondition(
    () => listProxiedApiRequests().some(isSuccessfulBlobAttachmentBinding),
    `Note attachment blob was not uploaded before sharing.\nrequests=\n${summarizeProxiedApiRequests()}`,
    DUAL_PANE_TEST_TIMEOUT_MS,
  );
}

function isRetryableDocumentSyncStaleFailure(
  request: ProxiedApiRequest,
): boolean {
  let code: unknown;
  try {
    const body = JSON.parse(request.responseBody) as unknown;
    code =
      typeof body === "object" && body !== null
        ? Reflect.get(body, "code")
        : null;
  } catch {
    code = null;
  }

  return (
    request.method === "POST" &&
    request.status === 409 &&
    /^\/documents\/[^/]+\/sync$/u.test(requestPath(request.url)) &&
    code === DOCUMENT_SYNC_ERROR_CODES.stateStale
  );
}

export function isDocumentWriterProjectionStaleContentBundleFailure(
  request: ProxiedApiRequest,
): boolean {
  return (
    request.method === "GET" &&
    request.status === 409 &&
    /^\/documents\/[^/]+\/writer-projection$/u.test(requestPath(request.url)) &&
    request.responseBody.includes("Document content-key bundle is stale")
  );
}

function hasLaterSuccessfulRetry(
  requests: readonly ProxiedApiRequest[],
  failedRequestIndex: number,
): boolean {
  const failedRequest = requests[failedRequestIndex];
  if (!failedRequest) {
    return false;
  }

  return requests
    .slice(failedRequestIndex + 1)
    .some(
      (request) =>
        request.method === failedRequest.method &&
        request.url === failedRequest.url &&
        request.status >= 200 &&
        request.status < 400,
    );
}

function listUnresolvedPostShareFailures(
  requests: readonly ProxiedApiRequest[],
): ProxiedApiRequest[] {
  return requests.filter((request, index) => {
    if (request.status < 400) {
      return false;
    }
    if (
      isRetryableDocumentSyncStaleFailure(request) &&
      hasLaterSuccessfulRetry(requests, index)
    ) {
      return false;
    }

    return true;
  });
}

function listPaneErrorLines(panes: readonly HTMLElement[]): string[] {
  return panes.flatMap((pane) => {
    const text = pane.textContent ?? "";
    return text
      .split(/(?=\[\d{1,2}:\d{2}:\d{2})/u)
      .filter((line) => line.includes("ERROR:"))
      .map((line) => truncateText(line));
  });
}

export async function waitForNoPostShareSyncFailures(
  panes: readonly HTMLElement[],
  baseline: PostShareSyncBaseline,
) {
  const startedAt = Date.now();
  let runtimeSettled = false;
  let unresolvedFailures: readonly ProxiedApiRequest[] = [];
  while (Date.now() - startedAt < POST_SHARE_SYNC_SETTLE_TIMEOUT_MS) {
    const remainingTimeoutMs = Math.max(
      0,
      POST_SHARE_SYNC_SETTLE_TIMEOUT_MS - (Date.now() - startedAt),
    );

    await act(async () => {
      runtimeSettled = await waitForAppTestRuntimeToSettle({
        apiQuietMs: POST_SHARE_NETWORK_IDLE_QUIET_MS,
        timeoutMs: remainingTimeoutMs,
      });
    });

    const postShareRequests = listProxiedApiRequests().slice(
      baseline.requestStartIndex,
    );
    const paneErrors = listPaneErrorLines(panes);
    const syncLaneErrors = listAppTestSyncLaneErrorsSince(
      baseline.syncLaneErrors,
    );
    unresolvedFailures = listUnresolvedPostShareFailures(postShareRequests);

    expect(
      unresolvedFailures.filter(
        (request) => !isRetryableDocumentSyncStaleFailure(request),
      ),
      `Unexpected post-share API failures.\nrequests=\n${summarizeProxiedApiRequests(postShareRequests)}`,
    ).toEqual([]);
    expect(
      paneErrors,
      `Unexpected post-share pane errors.\npaneErrors=\n${paneErrors.join("\n")}\nrequests=\n${summarizeProxiedApiRequests(postShareRequests)}`,
    ).toEqual([]);
    expect(
      syncLaneErrors,
      `Unexpected post-share sync lane errors.\nrequests=\n${summarizeProxiedApiRequests(postShareRequests)}`,
    ).toEqual([]);

    if (runtimeSettled && unresolvedFailures.length === 0) {
      return;
    }
    if (!runtimeSettled) {
      break;
    }
  }

  expect(
    runtimeSettled,
    `Post-share sync runtime did not settle.\nrequests=\n${summarizeProxiedApiRequests(listProxiedApiRequests().slice(baseline.requestStartIndex))}`,
  ).toBe(true);
  expect(
    unresolvedFailures,
    `Unresolved post-share sync failures.\nrequests=\n${summarizeProxiedApiRequests(listProxiedApiRequests().slice(baseline.requestStartIndex))}`,
  ).toEqual([]);
}
