/**
 * The bridge object Capacitor installs on `window`.
 *
 * Declared rather than cast at the call site, so the read stays free of type
 * assertions (see scripts/lintPackageAssertions.ts), and declared inside this
 * imported module rather than in a standalone .d.ts for the reason given in
 * mini-apps/system-monitor/environment/environmentSources.ts: the deployment targets compile
 * this package's sources directly, so a global .d.ts nothing imports would only
 * load in this package's own tsconfig program.
 *
 * Optional throughout: in a plain browser the object is absent entirely, and the
 * shape is whatever the running shell installed, not something this package can
 * type-check against a dependency it does not have.
 */
declare global {
  interface CapacitorBridge {
    isNativePlatform?: () => boolean;
  }

  interface Window {
    Capacitor?: CapacitorBridge;
  }
}

/**
 * Whether this bundle is running inside the native Capacitor shell (the
 * installed iOS/Android app), as opposed to any browser context.
 *
 * Read off the global rather than by importing `@capacitor/core`:
 * `packages/app` is shell-agnostic and every other platform difference arrives
 * through {@link AppHostConfig}, so it must not take a Capacitor dependency. The
 * native bridge injects `window.Capacitor` before the bundle loads, and
 * `@capacitor/core` — which the shell entry point does import — augments that
 * same global, so the question is answerable from here without one.
 *
 * Deliberately narrow: it reports the *native* shell only. `app-capacitor`'s
 * Vite dev server installs the global too but reports the `web` platform, and
 * there the app should behave like the browser build it is.
 *
 * Prefer injecting through the host config for anything a shell can *supply* (a
 * file saver, a network status source). This is for the residual case: UI that
 * is merely meaningless on a phone or tablet and should not render there.
 */
export function isCapacitor(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.Capacitor?.isNativePlatform?.() === true;
}
