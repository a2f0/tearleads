import {
  type ReconnectRefreshState,
  transitionReconnectRefresh,
} from "./reconnectRefreshMachine";

export class ReconnectRefresh {
  private state: ReconnectRefreshState = { status: "idle" };
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(acknowledged: boolean) {
    if (acknowledged) this.acknowledge();
  }

  acknowledge(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.state = transitionReconnectRefresh(this.state, {
      type: "acknowledged",
    });
  }

  runWhenReady(
    canRun: () => boolean,
    refresh: (options: { onFullyHydrated: () => void }) => Promise<boolean>,
  ): void {
    if (this.state.status !== "pending" || !canRun()) return;

    const crawl = {};
    this.state = transitionReconnectRefresh(this.state, {
      type: "start",
      crawl,
    });
    const finish = (complete: boolean) => {
      const next = transitionReconnectRefresh(this.state, {
        type: "finish",
        crawl,
        complete,
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
    let fullyHydrated = false;
    void refresh({
      onFullyHydrated: () => {
        fullyHydrated = true;
      },
    }).then(
      () => finish(fullyHydrated),
      () => finish(false),
    );
  }
}
