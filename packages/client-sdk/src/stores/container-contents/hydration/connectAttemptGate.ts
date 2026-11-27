import {
  type ConnectAttemptWait,
  type ConnectAttemptWaitEvent,
  NO_CONNECT_ATTEMPT_WAIT,
  transitionConnectAttemptWait,
} from "../../../workflows/shared/connectAttemptWaitMachine";
import type { ReconnectRefresh } from "./reconnectRefresh";

/**
 * Holds the crawl that regained sync prerequisites start until the connect
 * attempt in flight settles, through `connectAttemptWaitMachine.ts`.
 *
 * Coming back online starts a tree crawl and, in a host that keeps a
 * server-events connection, a connect attempt. That attempt's interest
 * acknowledgement starts a crawl of its own, which must list after the
 * acknowledgement because hints sent before it are lost. A crawl that listed
 * before the acknowledgement therefore saves nothing: the tree was listed
 * twice on every reconnect. So the first crawl waits here before it starts:
 *
 * | Connect attempt when the crawl is requested | The crawl |
 * | --- | --- |
 * | none pending | starts at once |
 * | pending, then acknowledged | yields: the acknowledgement's crawl lists |
 * | pending, then ended or replaced without an acknowledgement | starts, or is requested again if the store's generation moved |
 *
 * A crawl that yielded, or that the acknowledgement superseded while it was
 * listing, waits behind the acknowledgement's crawl. It is dropped when that
 * crawl completes or gives up, and restored when the acknowledgement stops
 * being current before that crawl lists: the socket dropped, so that crawl
 * cannot run again until a new acknowledgement, and nothing else would list
 * the tree meanwhile. A crawl still listing when the acknowledgement is lost
 * is waited out first, so the restored crawl does not join one whose answer
 * is discarded.
 *
 * A waiting crawl counts as hydrating: the tree is listed when its wait ends,
 * by it or by the acknowledgement's crawl. A yielded one does not: the
 * acknowledgement's crawl reports its own hydration. Neither holds the
 * store's hydration slot, so nothing queues behind them: a refresh, a write's
 * follow-up crawl or a parent-lane request made meanwhile starts at once.
 *
 * The store observes the gate after every runtime update and whenever the
 * acknowledgement's crawl settles, and resets it when it is reset or retired.
 */

interface HeldCrawl {
  /** Starts the crawl, or requests it again if the store's generation moved. */
  readonly run: () => Promise<void>;
  /** Settles the caller of a waiting crawl with what came of its wait. */
  readonly settleWait: (crawl: Promise<void> | undefined) => void;
  readonly waited: Promise<void>;
}

export interface ConnectAttemptGateStore {
  readonly reconnectRefresh: Pick<ReconnectRefresh, "crawling" | "owesCrawl">;
  readonly runtime: {
    readonly isAcknowledgementCurrent?: (() => boolean) | undefined;
    readonly state: {
      readonly serverEventsPendingConnectAttempt?: number | undefined;
    };
  };
}

/**
 * Whether the crawl an acknowledged connection owes will list the tree. A
 * crawl left over from a connection that has since dropped vouches for
 * nothing: the crawl that would yield to it must list.
 */
export function owesAcknowledgedCrawl(store: ConnectAttemptGateStore): boolean {
  return (
    store.reconnectRefresh.owesCrawl &&
    store.runtime.isAcknowledgementCurrent?.() !== false
  );
}

function createHeldCrawl(run: () => Promise<void>): HeldCrawl {
  let settleWait: HeldCrawl["settleWait"] = () => undefined;
  const waited = new Promise<void>((resolve) => {
    settleWait = (crawl) => resolve(crawl);
  });
  return { run, settleWait, waited };
}

export class ConnectAttemptGate {
  private wait: ConnectAttemptWait<HeldCrawl> = NO_CONNECT_ATTEMPT_WAIT;

  constructor(
    private readonly store: ConnectAttemptGateStore,
    /** Observes a restored crawl, which no caller awaits. */
    private readonly observeRestored: (crawl: Promise<void>) => void,
  ) {}

  /**
   * Holds `run` until the connect attempt pending now settles. Null when no
   * attempt is pending and nothing is held: the caller crawls now. A crawl
   * requested while another is held joins it.
   */
  hold(run: () => Promise<void>): Promise<void> | null {
    if (this.wait.status === "waiting") return this.wait.request.waited;
    if (this.wait.status === "yielded") return Promise.resolve();
    const held = createHeldCrawl(run);
    const next = transitionConnectAttemptWait(this.wait, {
      pendingConnectAttempt:
        this.store.runtime.state.serverEventsPendingConnectAttempt,
      request: held,
      type: "hold",
    });
    this.wait = next.state;
    return next.released ? null : held.waited;
  }

  /** Parks a crawl superseded while the acknowledged crawl is owed. */
  park(run: () => Promise<void>): void {
    const held = createHeldCrawl(run);
    held.settleWait(undefined);
    this.dispatch({ request: held, type: "yield" });
  }

  /** Moves the gate on with what the store sees of its connection now. */
  observe(): void {
    const { reconnectRefresh } = this.store;
    this.dispatch({
      // Being listed, the acknowledged crawl is waited out even if its
      // acknowledgement is lost: its answer settles what comes next.
      acknowledged:
        reconnectRefresh.crawling || owesAcknowledgedCrawl(this.store),
      pendingConnectAttempt:
        this.store.runtime.state.serverEventsPendingConnectAttempt,
      type: "observe",
    });
    if (!reconnectRefresh.owesCrawl) {
      this.dispatch({ type: "covered" });
    } else if (
      !reconnectRefresh.crawling &&
      !owesAcknowledgedCrawl(this.store)
    ) {
      this.dispatch({ type: "acknowledgementLost" });
    }
  }

  /** The store was reset or retired: a waiting crawl runs its retry path. */
  reset(): void {
    this.dispatch({ type: "reset" });
  }

  private dispatch(event: ConnectAttemptWaitEvent<HeldCrawl>): void {
    const previous = this.wait;
    const { released, state } = transitionConnectAttemptWait(previous, event);
    this.wait = state;
    if (previous.status === "waiting" && state.status === "yielded") {
      previous.request.settleWait(undefined);
    }
    if (!released) return;
    if (previous.status === "waiting") released.settleWait(released.run());
    else this.observeRestored(released.run());
  }
}
