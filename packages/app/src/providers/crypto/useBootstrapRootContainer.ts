import {
  classifyDatabaseFailure,
  retryWhileDatabaseBusy,
} from "@tearleads/client-sdk/sqlite";
import { type MutableRefObject, useEffect, useRef } from "react";
import type { useDatabase } from "../db/DatabaseProvider";
import type { useIdentity } from "../identity/IdentityProvider";
import type { useTearleads } from "../sdk/TearleadsProvider";

/**
 * How long a root bootstrap the SQLite worker kept refusing behind another
 * tab's transaction waits before it runs again. Nothing this effect depends
 * on changes when that transaction ends, so without the timer the bootstrap
 * waited for an unrelated status, client, or fingerprint change (#3360).
 */
const BUSY_ROOT_BOOTSTRAP_RETRY_MS = 1_000;

type BusyRetryTimer = MutableRefObject<ReturnType<typeof setTimeout> | null>;

/**
 * Drops a bootstrap waiting out a busy refusal: its timer and its recorded
 * attempt, so the next qualifying render starts a fresh one.
 */
function cancelBusyRetry(
  timer: BusyRetryTimer,
  containerBootstrapped: MutableRefObject<RootBootstrapAttempt | null>,
): void {
  if (timer.current === null) return;
  clearTimeout(timer.current);
  timer.current = null;
  containerBootstrapped.current = null;
}

export interface RootBootstrapAttempt {
  readonly signIn: () => boolean;
  readonly scope: ReturnType<typeof useTearleads>["domainScope"];
  readonly dbClient: ReturnType<typeof useDatabase>["client"];
  readonly signingFingerprint: string;
}

export function useResetCryptoSession(
  containerBootstrapped: MutableRefObject<RootBootstrapAttempt | null>,
  signingKeyPair: ReturnType<typeof useIdentity>["signingKeyPair"],
  resetSession: () => void,
) {
  useEffect(() => {
    if (signingKeyPair) {
      return;
    }

    containerBootstrapped.current = null;
    resetSession();
  }, [containerBootstrapped, resetSession, signingKeyPair]);
}

export function useBootstrapCryptoSessionContainer(
  containerBootstrapped: MutableRefObject<RootBootstrapAttempt | null>,
  tearleads: ReturnType<typeof useTearleads>,
  containerId: string | null,
  signingFingerprint: string | null,
  dbStatus: ReturnType<typeof useDatabase>["status"],
  dbClient: ReturnType<typeof useDatabase>["client"],
  logError: (message: string, error: unknown) => void,
) {
  const scope = tearleads.domainScope;
  const signIn = tearleads.session.captureSignIn();
  const busyRetry: BusyRetryTimer = useRef(null);
  useEffect(
    () => () => {
      // Unmounting ends the attempt: its timer and any busy retries stop.
      cancelBusyRetry(busyRetry, containerBootstrapped);
      containerBootstrapped.current = null;
    },
    [containerBootstrapped],
  );
  useEffect(() => {
    // A root container from elsewhere leaves a busy bootstrap nothing to do.
    if (containerId !== null) cancelBusyRetry(busyRetry, containerBootstrapped);
    const previous = containerBootstrapped.current;
    if (
      containerId !== null ||
      !signingFingerprint ||
      dbStatus !== "ready" ||
      !dbClient ||
      (previous?.scope === scope &&
        previous.signIn() &&
        previous?.dbClient === dbClient &&
        previous.signingFingerprint === signingFingerprint)
    )
      return;
    const attempt = { scope, dbClient, signingFingerprint, signIn };
    containerBootstrapped.current = attempt;
    const current = () =>
      containerBootstrapped.current === attempt &&
      tearleads.domainScope === scope &&
      signIn();
    const run = async (): Promise<void> => {
      try {
        await retryWhileDatabaseBusy(
          () => tearleads.session.bootstrapLocalRootContainer(current),
          { isCurrent: current },
        );
      } catch (error: unknown) {
        if (!current()) return;
        const failure = classifyDatabaseFailure(error);
        // The attempt stays recorded, so a re-render does not start a second.
        if (failure === "busy") {
          busyRetry.current = setTimeout(() => {
            busyRetry.current = null;
            if (current()) void run();
          }, BUSY_ROOT_BOOTSTRAP_RETRY_MS);
          return;
        }
        containerBootstrapped.current = null;
        // Reloads and identity transitions retire the worker beneath pending
        // queries. The next ready client retries; real SQL failures still log.
        if (failure === "failed") {
          logError("Failed to bootstrap root container", error);
        }
      }
    };
    void run();
  }, [
    containerBootstrapped,
    dbStatus,
    dbClient,
    containerId,
    logError,
    scope,
    signIn,
    signingFingerprint,
    tearleads,
  ]);
}
