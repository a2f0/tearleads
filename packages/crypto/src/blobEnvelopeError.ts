/**
 * A blob envelope failed structural validation. Distinct from other errors so
 * a caller can report a malformed envelope as the submitter's fault without
 * also reporting its own faults that way.
 */
export class BlobEnvelopeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BlobEnvelopeError";
  }
}
