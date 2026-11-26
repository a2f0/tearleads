import { ProjectionDependencyUnavailableError } from "../../../data/shared/dependencyUnavailable";
import type {
  HydrationOutcome,
  ReconnectCrawl,
} from "../../../workflows/container-contents/remoteHydration";
import {
  type ReconnectOutcome,
  type ReconnectRefreshState,
  transitionReconnectRefresh,
} from "./reconnectRefreshMachine";

export class ReconnectRefresh {
  private state: ReconnectRefreshState = { status: "idle" };
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(acknowledged: boolean) {
    if (acknowledged) this.reset("acknowledged");
  }

  /**
   * Whether a crawl for an acknowledged connection is still to run or to be
   * retried: one that will list the root lane and every known lane.
   */
  get owesCrawl(): boolean {
    const { status } = this.state;
    return (
      status === "pending" || status === "crawling" || status === "backoff"
    );
  }

  reset(type: "acknowledged" | "runtimeChanged" | "disposed"): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.state = transitionReconnectRefresh(this.state, { type });
  }

  runWhenReady(
    canRun: () => boolean,
    refresh: (options: { reconnect: ReconnectCrawl }) => Promise<boolean>,
  ): void {
    if (this.state.status !== "pending" || !canRun()) return;
    const crawl = {};
    this.state = transitionReconnectRefresh(this.state, {
      type: "start",
      crawl,
    });
    const isCurrent = () =>
      this.state.status === "crawling" &&
      this.state.crawl === crawl &&
      canRun();
    const finish = (outcome: ReconnectOutcome) => {
      const next = transitionReconnectRefresh(this.state, {
        type: "finish",
        crawl,
        outcome,
      });
      if (next === this.state) return;
      this.state = next;
      if (next.status !== "backoff") return;
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.state = transitionReconnectRefresh(this.state, {
          type: "retry",
          crawl,
        });
        this.runWhenReady(canRun, refresh);
      }, next.delayMs);
    };
    // A joined or interrupted crawl that never reported coverage owes a retry.
    let outcome: HydrationOutcome = "retry";
    let manualRejection: Error | undefined;
    void refresh({
      reconnect: {
        isCurrent,
        record: (value, error) => {
          outcome = value;
          manualRejection = error;
        },
      },
    }).then(
      () => finish(isCurrent() ? outcome : "retry"),
      (error: unknown) => {
        if (!isCurrent()) return finish("retry");
        if (manualRejection && manualRejection === error)
          return finish(outcome);
        finish(
          error instanceof ProjectionDependencyUnavailableError
            ? "retry"
            : "unexpectedFailure",
        );
      },
    );
  }
}
