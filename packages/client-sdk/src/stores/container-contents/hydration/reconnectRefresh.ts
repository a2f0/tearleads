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

  runtimeChanged(): void {
    this.state = transitionReconnectRefresh(this.state, {
      type: "runtimeChanged",
    });
  }

  runWhenReady(
    canRun: () => boolean,
    refresh: (options: {
      onFullyHydrated: () => void;
      reconnectIsCurrent: () => boolean;
    }) => Promise<boolean>,
    evidence: {
      containerListingFailures: number;
      containerProofRefusals: number;
    },
  ): void {
    if (this.state.status !== "pending" || !canRun()) return;

    const crawl = {};
    this.state = transitionReconnectRefresh(this.state, {
      type: "start",
      crawl,
    });
    const { containerListingFailures, containerProofRefusals } = evidence;
    const finish = (outcome: "complete" | "retry" | "refused") => {
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
        this.runWhenReady(canRun, refresh, evidence);
      }, next.delayMs);
    };
    let fullyHydrated = false;
    const settle = () => {
      if (fullyHydrated && canRun()) return finish("complete");
      const proofRefused =
        evidence.containerProofRefusals > containerProofRefusals &&
        evidence.containerListingFailures === containerListingFailures;
      finish(proofRefused ? "refused" : "retry");
    };
    void refresh({
      reconnectIsCurrent: () =>
        this.state.status === "crawling" &&
        this.state.crawl === crawl &&
        canRun(),
      onFullyHydrated: () => {
        fullyHydrated = true;
      },
    }).then(settle, () => finish("retry"));
  }
}
