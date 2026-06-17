import { useEffect, useRef } from "react";
import type { useDatabase } from "../db/DatabaseProvider";

// How many times to automatically re-attempt local-identity database boot after
// a failure before leaving it in `error` for the user to retry, and how long to
// wait between attempts.
//
// The persistent OPFS-SAHPool backend can fail to boot *transiently* on a reload:
// the previous page's worker may still hold the VFS's exclusive OPFS access
// handles when the new page's worker tries to install the VFS, so the install
// loses the lock-contention race. That clears on its own once those handles are
// released, so a few spaced auto-retries turn the flake into a successful boot
// without the user noticing.
//
// The cap matters for offline mode: when the database genuinely cannot boot
// (offline reload with no cached `sqlite3.wasm`), every attempt fails, so after
// these few retries we stop and let the status settle to `error` — that is what
// Explorer's boot-error/Retry surface keys off (see ExplorerDatabaseErrorStatus
// and ExplorerOfflineBoot.test). Keep the total (attempts × delay) well under the
// pane async test timeout so the offline error still surfaces promptly.
const IDENTITY_DB_BOOT_MAX_AUTO_RETRIES = 3;
const IDENTITY_DB_BOOT_RETRY_DELAY_MS = 750;

export function useEnsureDatabaseForIdentity(
  signingFingerprint: string | null,
  dbStatus: ReturnType<typeof useDatabase>["status"],
  ensureIdentityDatabaseReady: ReturnType<
    typeof useDatabase
  >["ensureIdentityReady"],
  logError: (message: string, error: unknown) => void,
) {
  // Auto-retry budget for the current fingerprint; reset whenever the identity
  // we are booting a database for changes.
  const retriesRef = useRef(0);
  // Re-entrancy guard for a single boot attempt. ensureIdentityReady
  // *synchronously* resets a failed runtime to `idle` before spawning a fresh
  // one, so calling it re-renders this hook with `dbStatus === "idle"` and would
  // re-enter and fire a second, redundant boot. We set this flag immediately
  // before an attempt and clear it on a microtask, so only that reflexive
  // same-tick `idle` is suppressed — a genuine later `idle` (e.g. Explorer's
  // Retry, which calls clearWorker() to reset to idle and rely on this effect to
  // re-boot) still triggers a fresh attempt.
  const attemptInFlightRef = useRef(false);
  useEffect(() => {
    // A new identity is an independent boot: reset the retry budget and clear any
    // stale in-flight marker so the new fingerprint's first `idle` is not mistaken
    // for the previous boot's reflexive re-entry.
    retriesRef.current = 0;
    attemptInFlightRef.current = false;
  }, [signingFingerprint]);

  useEffect(() => {
    if (!signingFingerprint) {
      return;
    }

    // `idle` is the normal first boot. `error` is a failed boot we may retry:
    // ensureIdentityReady spawns a fresh worker for a DB pinned in error, so a
    // transient SAHPool contention failure can still succeed on a later attempt.
    if (dbStatus !== "idle" && dbStatus !== "error") {
      return;
    }
    // Suppress the reflexive idle re-entry triggered synchronously by our own
    // in-flight attempt (see attemptInFlightRef).
    if (dbStatus === "idle" && attemptInFlightRef.current) {
      return;
    }
    if (
      dbStatus === "error" &&
      retriesRef.current >= IDENTITY_DB_BOOT_MAX_AUTO_RETRIES
    ) {
      // Out of auto-retries: leave the status at `error` so the UI can surface a
      // manual Retry rather than spinning forever (important for offline mode).
      return;
    }

    let cancelled = false;
    const attempt = () => {
      if (cancelled) {
        return;
      }
      // Mark the attempt in flight across the synchronous part of
      // ensureIdentityReady (which may reset status to `idle`), then clear it on a
      // microtask so the reflexive same-tick re-render is suppressed but later
      // transitions are not.
      attemptInFlightRef.current = true;
      void Promise.resolve().then(() => {
        attemptInFlightRef.current = false;
      });
      void ensureIdentityDatabaseReady(signingFingerprint).catch(
        (error: unknown) => {
          logError("Failed to initialize SQLite for local identity", error);
        },
      );
    };

    if (dbStatus === "error") {
      // Space retries out so the previous worker's OPFS handles have time to be
      // released before we try to re-acquire them.
      retriesRef.current += 1;
      const timeoutId = setTimeout(attempt, IDENTITY_DB_BOOT_RETRY_DELAY_MS);
      return () => {
        cancelled = true;
        clearTimeout(timeoutId);
      };
    }

    attempt();
    return () => {
      cancelled = true;
    };
  }, [dbStatus, ensureIdentityDatabaseReady, logError, signingFingerprint]);
}
