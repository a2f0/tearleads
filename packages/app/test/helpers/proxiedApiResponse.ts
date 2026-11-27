export interface ProxiedApiRequest {
  authorization: string | null;
  knownManifestsCount?: number;
  method: string;
  requestBody: string | null;
  requestBodyBytes: number;
  responseBody: string;
  responseBodyBytes: number;
  status: number;
  url: string;
}

function countKnownManifests(header: string | null): number {
  if (!header) return 0;
  return header
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0).length;
}

export async function recordProxiedApiResponse(input: {
  request: Request;
  requestBody: ArrayBuffer | null;
  response: Response;
}): Promise<{ record: ProxiedApiRequest; responseBytes: ArrayBuffer }> {
  const responseBytes = await input.response.arrayBuffer();
  const decoder = new TextDecoder();
  return {
    record: {
      authorization: input.request.headers.get("authorization"),
      knownManifestsCount: countKnownManifests(
        input.request.headers.get("x-known-manifests"),
      ),
      method: input.request.method,
      requestBody:
        input.requestBody === null ? null : decoder.decode(input.requestBody),
      requestBodyBytes: input.requestBody?.byteLength ?? 0,
      responseBody: decoder.decode(responseBytes),
      responseBodyBytes: responseBytes.byteLength,
      status: input.response.status,
      url: input.request.url,
    },
    responseBytes,
  };
}
