import { createListenerSet } from "./listenerSet";
export interface EventsSnapshot {
  connected: boolean;
  events: ReadonlyArray<unknown>;
}

export type EventsListener = () => void;

export class Events {
  private connectedValue = false;
  private connectionGenerationValue = 0;
  private readonly listeners = createListenerSet();
  private snapshotValue: EventsSnapshot;

  constructor(
    events: ReadonlyArray<unknown> = [],
    private readonly invalidateAccessCaches: () => void = () => undefined,
  ) {
    this.snapshotValue = { connected: this.connectedValue, events };
  }

  get connected(): boolean {
    return this.connectedValue;
  }

  get connectionGeneration(): number {
    return this.connectionGenerationValue;
  }

  get events(): ReadonlyArray<unknown> {
    return this.snapshotValue.events;
  }

  get snapshot(): EventsSnapshot {
    return this.snapshotValue;
  }

  clear(): void {
    this.setEvents([]);
  }

  push(event: unknown): void {
    this.setEvents([...this.events, event]);
  }

  /**
   * Drop HTTP writer projections after an access/keying control signal or an
   * event-stream gap. A peer re-key can make an otherwise-valid cached
   * projection stale even when no local mutation touched the cache.
   */
  invalidateAccessState(): void {
    this.invalidateAccessCaches();
  }

  setConnected(connected: boolean): void {
    if (this.connectedValue === connected) {
      return;
    }

    this.connectedValue = connected;
    if (connected) {
      this.connectionGenerationValue += 1;
    }
    this.updateSnapshot(this.events);
  }

  setEvents(events: ReadonlyArray<unknown>): void {
    if (this.events === events) {
      return;
    }

    this.updateSnapshot(events);
  }

  subscribe = (listener: EventsListener): (() => void) =>
    this.listeners.subscribe(listener);

  private updateSnapshot(events: ReadonlyArray<unknown>): void {
    this.snapshotValue = { connected: this.connectedValue, events };
    this.listeners.notify();
  }
}
