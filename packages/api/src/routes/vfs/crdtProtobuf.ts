import express, {
  type Request,
  type RequestHandler,
  type Response
} from 'express';

export const CRDT_PROTOBUF_CONTENT_TYPE = 'application/x-protobuf';

function hasContentTypeToken(headerValue: string, token: string): boolean {
  return headerValue
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .some((part) => part.includes(token.toLowerCase()));
}

export function isCrdtProtobufRequest(request: Request): boolean {
  const headerValue = request.header('content-type');
  if (typeof headerValue !== 'string') {
    return false;
  }

  return hasContentTypeToken(headerValue, CRDT_PROTOBUF_CONTENT_TYPE);
}

export function wantsCrdtProtobufResponse(request: Request): boolean {
  if (isCrdtProtobufRequest(request)) {
    return true;
  }

  const acceptHeader = request.header('accept');
  if (typeof acceptHeader !== 'string') {
    return false;
  }

  return hasContentTypeToken(acceptHeader, CRDT_PROTOBUF_CONTENT_TYPE);
}

export function readCrdtProtobufBody(request: Request): Uint8Array | null {
  if (request.body instanceof Buffer) {
    return new Uint8Array(request.body);
  }

  if (request.body instanceof Uint8Array) {
    return request.body;
  }

  return null;
}

export function sendCrdtProtobufOrJson<TPayload>(
  request: Request,
  response: Response,
  status: number,
  payload: TPayload,
  encode: (value: TPayload) => Uint8Array
): void {
  if (!wantsCrdtProtobufResponse(request)) {
    response.status(status).json(payload);
    return;
  }

  response
    .status(status)
    .set('Content-Type', CRDT_PROTOBUF_CONTENT_TYPE)
    .send(Buffer.from(encode(payload)));
}

export function decodeCrdtRequestBody(
  request: Request,
  decode: (bytes: Uint8Array) => unknown
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!isCrdtProtobufRequest(request)) {
    return { ok: true, value: request.body };
  }

  const protobufBody = readCrdtProtobufBody(request);
  if (!protobufBody) {
    return { ok: false, error: 'invalid protobuf request body' };
  }

  try {
    return {
      ok: true,
      value: decode(protobufBody)
    };
  } catch {
    return { ok: false, error: 'invalid protobuf request body' };
  }
}

export function createCrdtProtobufRawBodyParser(): RequestHandler {
  return express.raw({
    type: CRDT_PROTOBUF_CONTENT_TYPE,
    limit: process.env['API_JSON_BODY_LIMIT'] ?? '10mb'
  });
}
