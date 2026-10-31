import { createListenerSet } from "./listenerSet";
export interface EventsSnapshot {
  connected: boolean;
  events: ReadonlyArray<unknown>;
}

export type EventsListener = () => void;

export class Events {
  private connectedValue = false;
  private connectionGenerationValue = 0;
  private connectAttemptValue = 0;
  private pendingConnectAttemptValue: number | undefined = undefined;
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

  /**
   * The connect attempt whose interest acknowledgement is still outstanding,
   * or undefined. Document stores opened meanwhile defer their startup probe
   * to that acknowledgement's reconnect probe; an attempt that ends without
   * one releases the deferral, so each attempt gets its own id.
   */
  get pendingConnectAttempt(): number | undefined {
    return this.pendingConnectAttemptValue;
  }

  /** A connect attempt started: its acknowledgement will arm probes. */
  beginConnectAttempt(): number {
    this.connectAttemptValue += 1;
    this.pendingConnectAttemptValue = this.connectAttemptValue;
    this.updateSnapshot(this.events);
    return this.connectAttemptValue;
  }

  /** The attempt can no longer deliver an acknowledgement. */
  endConnectAttempt(attempt: number): void {
    if (this.pendingConnectAttemptValue !== attempt) {
      return;
    }
    this.pendingConnectAttemptValue = undefined;
    this.updateSnapshot(this.events);
  }

  setConnected(connected: boolean): void {
    if (
      this.connectedValue === connected &&
      this.pendingConnectAttemptValue === undefined
    ) {
      return;
    }

    if (this.connectedValue !== connected) {
      this.connectedValue = connected;
      if (connected) {
        this.connectionGenerationValue += 1;
      }
    }
    this.pendingConnectAttemptValue = undefined;
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
