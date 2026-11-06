import { HttpResponse } from "msw";
import {
  type ProxiedApiRequest,
  recordProxiedApiResponse,
} from "../proxiedApiResponse";
import { ensureTestApiApp } from "./testApiApp";

const proxiedApiRequests: ProxiedApiRequest[] = [];

interface ProxiedApiNetworkActivitySnapshot {
  activeRequestCount: number;
  completedRequestCount: number;
}

export interface TestApiAppHandlerOptions {
  /** Holds a request (e.g. registration) until the returned promise settles. */
  holdRequest?: (request: Request) => Promise<void> | undefined;
  responseDelayMs?: number;
}

interface ActiveProxiedApiRequest {
  readonly label: string;
  readonly startedAt: number;
}

// In-flight proxied requests, so a settle timeout can name what it waited on.
const activeProxiedApiRequests = new Set<ActiveProxiedApiRequest>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function remainingTimeoutMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

async function waitForProxiedApiRequestsToDrain(
  deadline: number,
): Promise<void> {
  while (activeProxiedApiRequests.size > 0) {
    const remainingMs = remainingTimeoutMs(deadline);
    if (remainingMs <= 0) {
      return;
    }

    await delay(Math.min(10, remainingMs));
  }
}

async function waitForProxiedApiNetworkIdle(
  timeoutMs = 500,
  quietMs = 50,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let lastRequestCount = proxiedApiRequests.length;
  let quietStartedAt = Date.now();

  while (Date.now() <= deadline) {
    await waitForProxiedApiRequestsToDrain(deadline);

    const nextRequestCount = proxiedApiRequests.length;
    if (
      activeProxiedApiRequests.size === 0 &&
      nextRequestCount === lastRequestCount
    ) {
      if (Date.now() - quietStartedAt >= quietMs) {
        return true;
      }
    } else {
      lastRequestCount = nextRequestCount;
      quietStartedAt = Date.now();
    }

    const remainingMs = remainingTimeoutMs(deadline);
    if (remainingMs <= 0) {
      break;
    }

    await delay(Math.min(10, remainingMs));
  }

  return false;
}

export function getProxiedApiNetworkActivitySnapshot(): ProxiedApiNetworkActivitySnapshot {
  return {
    activeRequestCount: activeProxiedApiRequests.size,
    completedRequestCount: proxiedApiRequests.length,
  };
}

export const PROXIED_API_SETTLE_TIMEOUT_MS = 10_000;

export async function waitForProxiedApiRequestsToSettle(
  timeoutMs = PROXIED_API_SETTLE_TIMEOUT_MS,
  quietMs = 50,
): Promise<void> {
  const settled = await waitForProxiedApiNetworkIdle(timeoutMs, quietMs);
  if (settled) {
    return;
  }

  const state = getProxiedApiNetworkActivitySnapshot();
  const now = Date.now();
  const active = [...activeProxiedApiRequests]
    .map(({ label, startedAt }) => `${label} (${now - startedAt}ms)`)
    .join(", ");
  throw new Error(
    `Timed out waiting for proxied API network idle before resetting mock server. activeRequests=${state.activeRequestCount} [${active}], completedRequests=${state.completedRequestCount}, timeoutMs=${timeoutMs}, quietMs=${quietMs}`,
  );
}

export function listProxiedApiRequests(): ReadonlyArray<ProxiedApiRequest> {
  return [...proxiedApiRequests];
}

function toHeadersObject(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers as unknown as Iterable<[string, string]>);
}

export async function proxyRequestToApiApp(
  request: Request,
  options: TestApiAppHandlerOptions = {},
): Promise<Response> {
  const activeRequest: ActiveProxiedApiRequest = {
    label: `${request.method} ${new URL(request.url).pathname}`,
    startedAt: Date.now(),
  };
  activeProxiedApiRequests.add(activeRequest);
  try {
    await options.holdRequest?.(request);
    const apiApp = await ensureTestApiApp();
    const requestBody =
      request.method === "GET" || request.method === "HEAD"
        ? null
        : await request.arrayBuffer();
    const proxiedRequest =
      request.method === "GET" || request.method === "HEAD"
        ? new Request(request.url, {
            method: request.method,
            headers: request.headers,
          })
        : new Request(request.url, {
            method: request.method,
            headers: request.headers,
            body: requestBody,
          });
    const response = await apiApp.fetch(proxiedRequest);
    if (options.responseDelayMs !== undefined && options.responseDelayMs > 0) {
      await delay(options.responseDelayMs);
    }

    const { record, responseBytes } = await recordProxiedApiResponse({
      request,
      requestBody,
      response,
    });
    proxiedApiRequests.push(record);

    return new HttpResponse(responseBytes, {
      status: response.status,
      headers: toHeadersObject(response.headers),
    });
  } finally {
    activeProxiedApiRequests.delete(activeRequest);
  }
}

export function clearProxiedApiRequests(): void {
  activeProxiedApiRequests.clear();
  proxiedApiRequests.length = 0;
}
