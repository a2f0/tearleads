const CACHED_PAGE_EVICTION_CHANNEL_NAME =
  "tearleads-sqlite-cached-page-eviction";

let evictionChannel: BroadcastChannel | null = null;

/**
 * Evict this origin's pages held in the back/forward cache, and keep this page
 * evictable by the pages that follow it.
 *
 * A same-origin cross-document navigation (`location.assign`, a link) can store
 * the outgoing page in the cache, frozen together with its SQLite worker. The
 * page terminates that worker on `pagehide`, but the termination races the
 * freeze, so the frozen worker can keep the database's OPFS access handles and
 * every SAHPool install on the next page fails with contention until the cache
 * drops the page, which nothing forces.
 *
 * Chromium evicts a cached page when a `BroadcastChannel` the page holds open
 * receives a message. So every page that creates a runtime holds this channel
 * open for its lifetime and posts on it, which evicts any cached predecessor and
 * frees its handles before the new worker installs the VFS. The app reloads a
 * page restored from the cache anyway, so evicting one loses nothing.
 */
export function evictCachedDatabasePages(): void {
  if (typeof BroadcastChannel === "undefined") {
    return;
  }

  if (!evictionChannel) {
    evictionChannel = new BroadcastChannel(CACHED_PAGE_EVICTION_CHANNEL_NAME);
    // Bun and Node keep the process alive while a channel is open; a page has
    // no such hold, and the channel must outlive every runtime it creates.
    const unref: unknown = Reflect.get(evictionChannel, "unref");
    if (typeof unref === "function") {
      unref.call(evictionChannel);
    }
  }
  evictionChannel.postMessage(null);
}
