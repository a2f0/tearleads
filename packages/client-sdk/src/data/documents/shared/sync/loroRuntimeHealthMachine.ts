/**
 * Whether this realm's Loro runtime is fit to keep running (#3194). A
 * runtime failure, such as a WebAssembly trap, can leave the module's
 * memory and borrows unusable for the rest of the realm, and only a new
 * realm (a page reload) loads a fresh instance. Until then the update that
 * failed waits on this device's next lifetime, so the realm asks its host
 * for a restart. The host restarts only when its user says so, after
 * `prepareRuntimeRestart` has drained the realm's Loro read windows.
 */
export type LoroRuntimeHealth =
  | { readonly status: "healthy" }
  /** A runtime failure left the module suspect: the realm needs a restart. */
  | { readonly status: "restartRequired" }
  /**
   * The host asked to restart: no read window opens until the open ones
   * close, or the drain's wait ends. `drain` tags the request.
   */
  | { readonly status: "draining"; readonly drain: number }
  /**
   * Drained, and admitting no window for a short hold: the host may restart
   * the realm now. A realm its host kept running past the hold needs a
   * restart again.
   */
  | { readonly status: "ready" };

export type LoroRuntimeHealthEvent =
  /** The runtime failed, anywhere in the realm. */
  | { readonly type: "runtimeFailed" }
  /** The host asked to restart, as drain `drain`. */
  | { readonly type: "restartRequested"; readonly drain: number }
  /** Drain `drain` ended, with every window closed or its wait over. */
  | { readonly type: "windowsDrained"; readonly drain: number }
  /** A drain's hold ended: the realm admits read windows again. */
  | { readonly type: "windowsReopened" };

export const LORO_RUNTIME_HEALTHY: LoroRuntimeHealth = { status: "healthy" };

export function transitionLoroRuntimeHealth(
  current: LoroRuntimeHealth,
  event: LoroRuntimeHealthEvent,
): LoroRuntimeHealth {
  switch (event.type) {
    case "runtimeFailed":
      // A draining realm restarts anyway; a drained one the host kept
      // running needs a restart again.
      return current.status === "healthy" || current.status === "ready"
        ? { status: "restartRequired" }
        : current;
    case "restartRequested":
      // Only a failed realm drains, one drain at a time: a second request
      // joins the first, and a healthy realm has nothing to restart for.
      return current.status === "restartRequired" || current.status === "ready"
        ? { drain: event.drain, status: "draining" }
        : current;
    case "windowsDrained":
      return current.status === "draining" && current.drain === event.drain
        ? { status: "ready" }
        : current;
    case "windowsReopened":
      return current.status === "ready"
        ? { status: "restartRequired" }
        : current;
  }
}
