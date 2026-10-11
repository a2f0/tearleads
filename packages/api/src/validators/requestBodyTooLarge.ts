/**
 * Thrown from a body read once it passes the ingress ceiling; the API error
 * handler maps it to 413. Routes that catch parse failures must let it
 * through, or an overrun would be reported as malformed input.
 */
export class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}
