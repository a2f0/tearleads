export type NetworkListener = (online: boolean) => void;

function defaultOnline(): boolean {
  return typeof navigator === "object" && typeof navigator.onLine === "boolean"
    ? navigator.onLine
    : true;
}

export class Network {
  private readonly listeners = new Set<NetworkListener>();
  private onlineValue: boolean;

  constructor(online: boolean = defaultOnline()) {
    this.onlineValue = online;
  }

  get online(): boolean {
    return this.onlineValue;
  }

  setOnline(online: boolean): void {
    if (this.onlineValue === online) {
      return;
    }

    this.onlineValue = online;
    for (const listener of this.listeners) {
      try {
        listener(online);
      } catch {
        // Keep one subscriber failure from blocking later subscribers.
      }
    }
  }

  subscribe = (listener: NetworkListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
