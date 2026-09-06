import type { ProxiedApiRequest } from "./proxiedApiResponse";

export function documentSyncIntentCounts(
  requests: readonly ProxiedApiRequest[],
) {
  let readOnly = 0;
  let writeBearing = 0;
  for (const request of requests) {
    if (
      request.method !== "POST" ||
      !/^\/documents\/[^/]+\/sync$/u.test(new URL(request.url).pathname)
    )
      continue;
    const body: unknown = JSON.parse(request.requestBody ?? "null");
    if (
      body === null ||
      typeof body !== "object" ||
      !("outgoingUpdates" in body) ||
      !Array.isArray(body.outgoingUpdates)
    ) {
      throw new Error(
        "Cannot classify a document sync without outgoingUpdates",
      );
    }
    if (body.outgoingUpdates.length === 0) readOnly += 1;
    else writeBearing += 1;
  }
  return { readOnly, writeBearing };
}

export function proxiedApiBodyBytes(requests: readonly ProxiedApiRequest[]) {
  return requests.reduce(
    (total, request) => ({
      request: total.request + request.requestBodyBytes,
      response: total.response + request.responseBodyBytes,
    }),
    { request: 0, response: 0 },
  );
}
