// How a device reset coordinates the app's pages (browser tabs and windows).
//
// Every page that has the app mounted holds the shared app-pages Web Lock. A
// wipe takes the same lock exclusively, so it starts only after every such page
// has unloaded: a page's locks are released when its document is destroyed,
// after which none of its in-flight writes can land. Pages that are told about
// a reset reload instead of unmounting for exactly that reason, and come back
// showing a notice rather than the app, so only the requesting page boots the
// fresh device.

const DEVICE_RESET_CHANNEL = "tearleads.device-reset";
const APP_PAGES_LOCK = "tearleads.app-pages";
const RESET_ELSEWHERE_KEY = "tearleads.device-reset.elsewhere";

// Tags this page's broadcast, which its own subscription would also receive.
const PAGE_ID = crypto.randomUUID();

function lockManager(): LockManager | undefined {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  return typeof locks?.request === "function" ? locks : undefined;
}

/** Tells the app's other pages that this one is resetting the device. */
export function announceDeviceReset(): void {
  if (typeof BroadcastChannel === "undefined") {
    return;
  }
  const channel = new BroadcastChannel(DEVICE_RESET_CHANNEL);
  channel.postMessage(PAGE_ID);
  channel.close();
}

/**
 * While the app is mounted: reloads this page into the reset notice when
 * another page announces a reset. Returns an unsubscribe.
 */
export function reloadOnDeviceResetElsewhere(): () => void {
  if (typeof BroadcastChannel === "undefined") {
    return () => {};
  }
  const channel = new BroadcastChannel(DEVICE_RESET_CHANNEL);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (event.data === PAGE_ID) {
      return;
    }
    // sessionStorage belongs to this tab and survives its reload.
    globalThis.sessionStorage?.setItem(RESET_ELSEWHERE_KEY, "1");
    window.location.reload();
  };
  return () => channel.close();
}

/** Whether this page reloaded because another page reset the device. */
export function wasResetElsewhere(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(RESET_ELSEWHERE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Holds the shared app-pages lock for as long as the app may be mounted on
 * this page, calling `onHeld` once it is granted: at once where Web Locks are
 * unavailable. The app must not mount before then, or a wipe already holding
 * the lock would run under it. Returns the release.
 */
export function holdAppPageLock(onHeld: () => void): () => void {
  const locks = lockManager();
  if (!locks) {
    onHeld();
    return () => {};
  }
  const held = Promise.withResolvers<void>();
  const waiting = new AbortController();
  let released = false;
  void locks
    .request(APP_PAGES_LOCK, { mode: "shared", signal: waiting.signal }, () => {
      if (!released) {
        onHeld();
      }
      return held.promise;
    })
    // Released before it was granted.
    .catch(() => undefined);
  return () => {
    released = true;
    waiting.abort();
    held.resolve();
  };
}

/** Runs `run` once no other page has the app mounted. */
export async function runWithoutAppPages(
  signal: AbortSignal,
  run: () => Promise<void>,
): Promise<void> {
  const locks = lockManager();
  if (!locks) {
    await run();
    return;
  }
  await locks.request(APP_PAGES_LOCK, { signal }, run);
}
