import { expect } from "bun:test";
import { listProxiedApiRequests } from "./mswServer";

const MAX_REQUEST_SUMMARY_BODY_LENGTH = 500;

export type ProxiedApiRequest = ReturnType<
  typeof listProxiedApiRequests
>[number];

export function requestPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export function requestPathAndQuery(url: string): string {
  try {
    const parsedUrl = new URL(url);
    return `${parsedUrl.pathname}${parsedUrl.search}`;
  } catch {
    return url;
  }
}

function summarizeRequestBody(body: string | null): string {
  return body === null ? "null" : `<${body.length} chars>`;
}

export function truncateText(
  text: string,
  maxLength = MAX_REQUEST_SUMMARY_BODY_LENGTH,
): string {
  return text.length <= maxLength
    ? text
    : `${text.slice(0, maxLength)}... <${text.length} chars>`;
}

export function summarizeProxiedApiRequests(
  requests: readonly ProxiedApiRequest[] = listProxiedApiRequests(),
): string {
  return requests
    .map(
      (request) =>
        `${request.method} ${request.status} ${requestPath(request.url)} request=${summarizeRequestBody(request.requestBody)} response=${truncateText(request.responseBody)}`,
    )
    .join("\n");
}

export function expectGrantLocalProjectionRequestBoundary(
  requests: readonly ProxiedApiRequest[],
): void {
  const requestSummary = summarizeProxiedApiRequests(requests);
  expect(
    requests.filter(
      (request) =>
        request.method === "GET" &&
        /^\/organizations\/[^/]+\/read-model$/u.test(requestPath(request.url)),
    ),
    `Grant detail should open from the local projection without read-model reconciliation.\nrequests=\n${requestSummary}`,
  ).toEqual([]);
  expect(
    requests.filter((request) =>
      /^\/organizations\/[^/]+\/grants$/u.test(requestPath(request.url)),
    ),
    `Grant detail must not use the removed grants endpoint.\nrequests=\n${requestSummary}`,
  ).toEqual([]);
}
