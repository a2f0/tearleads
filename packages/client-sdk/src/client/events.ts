export interface EventsSnapshot {
  connected: boolean;
  events: ReadonlyArray<unknown>;
}

export type EventsListener = () => void;

export class Events {
  private connectedValue = false;
  private readonly listeners = new Set<EventsListener>();
  private snapshotValue: EventsSnapshot;

  constructor(events: ReadonlyArray<unknown> = []) {
    this.snapshotValue = { connected: this.connectedValue, events };
  }

  get connected(): boolean {
    return this.connectedValue;
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

  setConnected(connected: boolean): void {
    if (this.connectedValue === connected) {
      return;
    }

    this.connectedValue = connected;
    this.updateSnapshot(this.events);
  }

  setEvents(events: ReadonlyArray<unknown>): void {
    if (this.events === events) {
      return;
    }

    this.updateSnapshot(events);
  }

  subscribe = (listener: EventsListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Keep one subscriber failure from blocking later subscribers.
      }
    }
  }

  private updateSnapshot(events: ReadonlyArray<unknown>): void {
    this.snapshotValue = { connected: this.connectedValue, events };
    this.notifyListeners();
  }
}
