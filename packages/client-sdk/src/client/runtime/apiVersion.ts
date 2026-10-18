import { createListenerSet } from "./listenerSet";

/**
 * The API build that served this client's latest response, as named by the
 * API's version header: the commit count of the default branch it was built
 * from, so a later deploy always reads higher.
 *
 * Held in memory only. It describes the server answering right now, so a value
 * persisted across launches would misattribute the first failures after a
 * redeploy, and the first response of every session replaces it anyway.
 */
export class ApiVersion {
  private readonly listeners = createListenerSet<[number]>();
  private currentValue: number | null = null;

  /** Null until a response names its build. */
  get current(): number | null {
    return this.currentValue;
  }

  observe(version: number): void {
    if (this.currentValue === version) {
      return;
    }
    this.currentValue = version;
    this.listeners.notify(version);
  }

  subscribe = (listener: (version: number) => void): (() => void) =>
    this.listeners.subscribe(listener);
}
