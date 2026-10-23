import pg, { type PoolClient } from "pg";
import {
  PostgresConnectionError,
  postgresConnectionFailure,
} from "./postgresConnectionFailure";

type ConnectCallback = (
  error: Error | undefined,
  client: PoolClient | undefined,
  release: (error?: Error | boolean) => void,
) => void;

/**
 * Retry one transient acquisition failure, before any statement or transaction
 * reaches a client. Pool.query uses the callback overload, while Drizzle's
 * transactions use the promise overload; both must share this boundary.
 */
export class PostgresPool extends pg.Pool {
  override connect(): Promise<PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(
    callback?: ConnectCallback,
  ): Promise<PoolClient> | undefined {
    const result = this.acquire();
    if (!callback) return result;
    void result.then(
      (client) => callback(undefined, client, client.release),
      (error: Error) => callback(error, undefined, () => {}),
    );
    return undefined;
  }

  private async acquire(): Promise<PoolClient> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await super.connect();
      } catch (error) {
        const failure = postgresConnectionFailure(error);
        if (attempt < 2 && failure.retryable && !this.ending) continue;
        throw new PostgresConnectionError(
          failure.code,
          attempt,
          this.totalCount,
          this.idleCount,
          this.waitingCount,
          error,
        );
      }
    }
  }
}
