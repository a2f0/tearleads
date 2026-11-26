/**
 * Holds the crawl that regained sync prerequisites start until the connect
 * attempt in flight settles.
 *
 * Coming back online starts a tree crawl and, in a host that keeps a
 * server-events connection, a connect attempt. That attempt's interest
 * acknowledgement starts a crawl of its own, which must list after the
 * acknowledgement because hints sent before it are lost. A crawl that listed
 * before the acknowledgement therefore saves nothing: the tree was listed
 * twice on every reconnect. So the first crawl waits here once its local
 * preparation is done:
 *
 * | Connect attempt when the crawl is ready to list | The crawl |
 * | --- | --- |
 * | none pending | lists at once |
 * | pending, then acknowledged | is superseded; the acknowledgement's crawl lists |
 * | pending, then ended or replaced without an acknowledgement | lists |
 *
 * The wait is bounded by the host: a connect attempt ends when its request,
 * handshake or acknowledgement times out. A store that is reset or retired
 * releases every wait, and the crawl's own generation check then drops it.
 */

interface ConnectAttemptGateState {
  readonly runtime: {
    readonly state: {
      readonly serverEventsPendingConnectAttempt?: number | undefined;
    };
  };
}

interface ConnectAttemptWait {
  readonly attempt: number;
  readonly release: () => void;
}

const waitsByState = new WeakMap<object, Set<ConnectAttemptWait>>();

/** Whether a wait for `attempt` is over, given the attempt pending now. */
export function isConnectAttemptSettled(
  attempt: number,
  pendingConnectAttempt: number | undefined,
): boolean {
  return pendingConnectAttempt !== attempt;
}

/**
 * Resolves once the connect attempt pending now is acknowledged, ends, or is
 * replaced by another; at once when none is pending.
 */
export function waitForPendingConnectAttempt(
  state: ConnectAttemptGateState,
): Promise<void> {
  const attempt = state.runtime.state.serverEventsPendingConnectAttempt;
  if (attempt === undefined) return Promise.resolve();
  return new Promise((resolve) => {
    const waits = waitsByState.get(state) ?? new Set();
    waitsByState.set(state, waits);
    waits.add({ attempt, release: resolve });
  });
}

/**
 * Releases each wait whose attempt is no longer the pending one. The store
 * calls it after every runtime update. With `all`, releases every wait: the
 * store was reset or retired.
 */
export function releaseSettledConnectAttemptWaits(
  state: ConnectAttemptGateState,
  options: { readonly all?: boolean } = {},
): void {
  const waits = waitsByState.get(state);
  if (!waits) return;
  const pending = state.runtime.state.serverEventsPendingConnectAttempt;
  for (const wait of [...waits]) {
    if (options.all || isConnectAttemptSettled(wait.attempt, pending)) {
      waits.delete(wait);
      wait.release();
    }
  }
}
