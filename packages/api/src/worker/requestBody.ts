/**
 * nginx rejected oversized bodies before Bun buffered them. The Worker keeps
 * that guarantee itself: a declared length above the ceiling is refused
 * outright, and a body without a declared length (chunked, or a browser
 * stream) is read only up to the ceiling before the route sees it, so no
 * request can grow the isolate's memory past the limit the routes assume.
 */
export type BoundedRequest =
  | { readonly kind: "request"; readonly request: Request }
  | { readonly kind: "too-large" };

function declaredLength(request: Request): number | null {
  const header = request.headers.get("content-length");
  if (header === null) {
    return null;
  }
  const length = Number(header);
  return Number.isSafeInteger(length) && length >= 0 ? length : null;
}

async function readBounded(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function boundRequestBody(
  request: Request,
  maxBytes: number,
): Promise<BoundedRequest> {
  if (request.body === null) {
    return { kind: "request", request };
  }
  const declared = declaredLength(request);
  if (declared !== null) {
    return declared > maxBytes
      ? { kind: "too-large" }
      : { kind: "request", request };
  }
  const bytes = await readBounded(request.body, maxBytes);
  if (bytes === null) {
    return { kind: "too-large" };
  }
  const headers = new Headers(request.headers);
  headers.set("content-length", String(bytes.byteLength));
  return {
    kind: "request",
    request: new Request(request, { body: bytes, headers }),
  };
}
