import type { ScheduleTimer } from "../realtime/containerInterestRevalidation";

interface ScheduledWork {
  readonly at: number;
  readonly callback: () => void | Promise<void>;
}

/** Idle callbacks use one durable alarm, with no resident JavaScript timers. */
export class HubAlarmScheduler {
  private readonly pending = new Set<ScheduledWork>();
  private updates = Promise.resolve();
  private active = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private wake: (() => void) | undefined;

  constructor(
    private readonly storage: Pick<
      DurableObjectStorage,
      "getAlarm" | "setAlarm" | "deleteAlarm"
    >,
  ) {}

  readonly schedule: ScheduleTimer = (callback, delayMs) => {
    const work = { at: Date.now() + delayMs, callback };
    this.pending.add(work);
    this.refreshActiveTimer();
    return () => {
      this.pending.delete(work);
      this.refreshActiveTimer();
    };
  };

  /**
   * Alarms do not run concurrently with another alarm. While an event is
   * awaiting I/O, use a temporary timer too, so a slow recheck cannot defer a
   * proof deadline. The last completed event removes it, permitting sleep.
   */
  enter(wake: () => void): () => void {
    this.active++;
    this.wake = wake;
    this.refreshActiveTimer();
    return () => {
      this.active--;
      this.refreshActiveTimer();
    };
  }

  /** Expired deadlines run synchronously before any incoming event can route. */
  runDue(): Promise<void> {
    const now = Date.now();
    const due = [...this.pending]
      .filter((work) => work.at <= now)
      .sort((a, b) => a.at - b.at);
    const running: Array<void | Promise<void>> = [];
    for (const work of due) {
      if (!this.pending.delete(work)) continue;
      try {
        running.push(work.callback());
      } catch (error) {
        running.push(Promise.reject(error));
      }
    }
    this.refreshActiveTimer();
    return Promise.allSettled(running).then((results) => {
      const failures = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (failures.length)
        throw new AggregateError(failures, "Realtime alarm callbacks failed");
    });
  }

  private nextAt(): number | null {
    let next: number | null = null;
    for (const work of this.pending) next = Math.min(next ?? work.at, work.at);
    return next;
  }

  private refreshActiveTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.active === 0) return;
    const next = this.nextAt();
    if (next === null) return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.wake?.();
      },
      Math.max(0, next - Date.now()),
    );
  }

  /** Serialize alarm writes so an older event cannot overwrite a newer bound. */
  flush(): Promise<void> {
    const update = this.updates.then(async () => {
      const next = this.nextAt();
      const current = await this.storage.getAlarm();
      if (next === current) return;
      if (next === null) await this.storage.deleteAlarm();
      else await this.storage.setAlarm(next);
    });
    this.updates = update.catch(() => undefined);
    return update;
  }
}
