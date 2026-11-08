/** `wrangler dev` exited before it served; `output` is everything it printed. */
export class LocalWorkerExitedEarlyError extends Error {
  constructor(
    readonly exitCode: number,
    readonly output: string,
  ) {
    super(
      `wrangler dev exited early with code ${exitCode}\nwrangler dev output:\n${output.slice(-6000)}`,
    );
    this.name = "LocalWorkerExitedEarlyError";
  }
}

// workerd reports "Address already in use"; Node, which serves wrangler's
// inspector port, reports "listen EADDRINUSE: address already in use".
const PORT_COLLISION = /EADDRINUSE|address already in use/iu;

/** Lost a reserved port to another process before `wrangler dev` bound it. */
export function isPortCollision(error: unknown): boolean {
  return (
    error instanceof LocalWorkerExitedEarlyError &&
    PORT_COLLISION.test(error.output)
  );
}

/**
 * Port reservation releases each port before `wrangler dev` binds it, so
 * another process can take it first. Starts again on fresh ports only after
 * that bind failure, at most `attempts` times; every other failure, and the
 * last collision, propagates.
 */
export async function retryPortCollisions<T>(
  startOnce: () => Promise<T>,
  attempts: number,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await startOnce();
    } catch (error) {
      if (attempt >= attempts || !isPortCollision(error)) throw error;
    }
  }
}
