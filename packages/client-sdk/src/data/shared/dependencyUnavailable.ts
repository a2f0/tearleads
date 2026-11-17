/** Retryable missing transport/key material; this is not integrity evidence. */
export class ProjectionDependencyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectionDependencyUnavailableError";
  }
}
