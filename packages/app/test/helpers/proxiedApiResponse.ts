export interface ProxiedApiRequest {
  authorization: string | null;
  method: string;
  requestBody: string | null;
  requestBodyBytes: number;
  responseBody: string;
  responseBodyBytes: number;
  status: number;
  url: string;
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
