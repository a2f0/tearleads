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
function isPortCollision(error: unknown): boolean {
  return (
    error instanceof LocalWorkerExitedEarlyError &&
    PORT_COLLISION.test(error.output)
  );
}

/**
 * Port reservation releases each port before `wrangler dev` binds it, so
 * another process can take it first. Starts again on fresh ports only after
 * that bind failure, at most `attempts` times, and only while `minimumStartMs`
 * remains before `deadline`: a start with less time would fail as a timeout
 * and hide the collision. Every other failure, and the last collision,
 * propagates. Each retried collision is logged, so a run that later fails for
 * another reason still shows it.
 */
export async function retryPortCollisions<T>(
  startOnce: () => Promise<T>,
  limits: {
    readonly attempts: number;
    readonly deadline: number;
    readonly minimumStartMs: number;
  },
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await startOnce();
    } catch (error) {
      if (
        attempt >= limits.attempts ||
        limits.deadline - Date.now() < limits.minimumStartMs ||
        !isPortCollision(error)
      )
        throw error;
      console.warn(
        `wrangler dev lost a reserved port (attempt ${attempt} of ${limits.attempts}); starting again on fresh ports.`,
      );
    }
  }
}
