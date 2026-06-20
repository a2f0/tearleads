export type NetworkListener = (online: boolean) => void;
export type NetworkMode = "automatic" | "online" | "offline";

function defaultOnline(): boolean {
  return typeof navigator === "object" && typeof navigator.onLine === "boolean"
    ? navigator.onLine
    : true;
}

function resolveOnline(mode: NetworkMode, detectedOnline: boolean): boolean {
  if (mode === "online") {
    return true;
  }

  if (mode === "offline") {
    return false;
  }

  return detectedOnline;
}

export class Network {
  private readonly listeners = new Set<NetworkListener>();
  private detectedOnlineValue: boolean;
  private modeValue: NetworkMode = "automatic";

  constructor(online: boolean = defaultOnline()) {
    this.detectedOnlineValue = online;
  }

  get online(): boolean {
    return resolveOnline(this.modeValue, this.detectedOnlineValue);
  }

  get detectedOnline(): boolean {
    return this.detectedOnlineValue;
  }

  get mode(): NetworkMode {
    return this.modeValue;
  }

  setOnline(online: boolean): void {
    const previousOnline = this.online;
    if (this.detectedOnlineValue === online) {
      return;
    }

    this.detectedOnlineValue = online;
    if (this.online !== previousOnline) {
      this.notifyListeners();
    }
  }

  setMode(mode: NetworkMode): void {
    if (this.modeValue === mode) {
      return;
    }

    this.modeValue = mode;
    this.notifyListeners();
  }

  private notifyListeners(): void {
    const online = this.online;
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
