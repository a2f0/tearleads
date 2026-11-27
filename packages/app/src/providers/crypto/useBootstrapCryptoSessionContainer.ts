import {
  classifyDatabaseFailure,
  retryWhileDatabaseBusy,
} from "@tearleads/client-sdk/sqlite";
import { useEffect } from "react";
import type { useDatabase } from "../db/DatabaseProvider";
import type { useIdentity } from "../identity/IdentityProvider";
import type { useTearleads } from "../sdk/TearleadsProvider";
import {
  type RootBootstrap,
  type RootBootstrapAttempt,
  type RootBootstrapEvent,
  rootBootstrapAttempt,
  transitionRootBootstrap,
} from "./rootBootstrapMachine";

/**
 * How long a root bootstrap the SQLite worker kept refusing behind another
 * tab's transaction waits before it runs again (#3360).
 */
const BUSY_ROOT_BOOTSTRAP_RETRY_MS = 1_000;

/** Runs the `RootBootstrap` machine and the effects of entering its states. */
export interface RootBootstrapDriver {
  readonly state: () => RootBootstrap;
  readonly dispatch: (event: RootBootstrapEvent) => void;
  /** Starts a run of the attempt; the bootstrap hook installs it. */
  run: (attempt: RootBootstrapAttempt) => void;
}

export function createRootBootstrapDriver(): RootBootstrapDriver {
  let state: RootBootstrap = { status: "idle" };
  let busyPause: ReturnType<typeof setTimeout> | undefined;
  const driver: RootBootstrapDriver = {
    state: () => state,
    dispatch(event) {
      const previous = state;
      const next = transitionRootBootstrap(previous, event);
      if (next === previous) return;
      state = next;
      if (previous.status === "waitingBusy") clearTimeout(busyPause);
      if (next.status === "waitingBusy") {
        const { attempt } = next;
        busyPause = setTimeout(
          () => driver.dispatch({ type: "busyPauseEnded", attempt }),
          BUSY_ROOT_BOOTSTRAP_RETRY_MS,
        );
      }
      if (
        next.status === "running" &&
        (previous.status !== "running" || previous.attempt !== next.attempt)
      ) {
        driver.run(next.attempt);
      }
    },
    run: () => undefined,
  };
  return driver;
}

async function runRootBootstrap(
  driver: RootBootstrapDriver,
  attempt: RootBootstrapAttempt,
  tearleads: ReturnType<typeof useTearleads>,
  logError: (message: string, error: unknown) => void,
): Promise<void> {
  let sawLapse = false;
  const current = () => {
    const state = driver.state();
    const active =
      state.status === "running" &&
      state.attempt === attempt &&
      state.wanted &&
      tearleads.domainScope === attempt.scope &&
      attempt.signIn();
    if (!active) sawLapse = true;
    return active;
  };
  try {
    await retryWhileDatabaseBusy(
      () => tearleads.session.bootstrapLocalRootContainer(current),
      { isCurrent: current },
    );
    driver.dispatch({ type: "settled", attempt });
  } catch (error: unknown) {
    const failure = classifyDatabaseFailure(error);
    const wasCurrent = current();
    if (sawLapse && wasCurrent && failure === "failed") {
      // A brief lapse stopped the run in flight, then the same inputs were
      // wanted again before the rejection landed: restart with a fresh attempt
      // instead of logging a superseded failure and leaving bootstrap idle.
      driver.dispatch({ type: "start", attempt: { ...attempt } });
      return;
    }
    driver.dispatch({
      type: wasCurrent && failure === "busy" ? "busy" : "failed",
      attempt,
    });
    // Reloads and identity transitions retire the worker beneath pending
    // queries. The next ready client retries; real SQL failures still log.
    if (wasCurrent && failure === "failed") {
      logError("Failed to bootstrap root container", error);
    }
  }
}

export function useResetCryptoSession(
  rootBootstrap: RootBootstrapDriver,
  signingKeyPair: ReturnType<typeof useIdentity>["signingKeyPair"],
  resetSession: () => void,
) {
  useEffect(() => {
    if (signingKeyPair) {
      return;
    }

    rootBootstrap.dispatch({ type: "reset" });
    resetSession();
  }, [resetSession, rootBootstrap, signingKeyPair]);
}

export function useBootstrapCryptoSessionContainer(
  rootBootstrap: RootBootstrapDriver,
  tearleads: ReturnType<typeof useTearleads>,
  containerId: string | null,
  signingFingerprint: string | null,
  dbStatus: ReturnType<typeof useDatabase>["status"],
  dbClient: ReturnType<typeof useDatabase>["client"],
  logError: (message: string, error: unknown) => void,
) {
  const scope = tearleads.domainScope;
  const signIn = tearleads.session.captureSignIn();
  // A StrictMode remount wants the running attempt again before it notices.
  useEffect(
    () => () => rootBootstrap.dispatch({ type: "lapse" }),
    [rootBootstrap],
  );
  useEffect(() => {
    rootBootstrap.run = (attempt) =>
      void runRootBootstrap(rootBootstrap, attempt, tearleads, logError);
    if (
      containerId !== null ||
      !signingFingerprint ||
      dbStatus !== "ready" ||
      !dbClient
    ) {
      rootBootstrap.dispatch({ type: "lapse" });
      return;
    }
    const previous = rootBootstrapAttempt(rootBootstrap.state());
    if (
      previous?.scope === scope &&
      previous.signIn() &&
      previous.dbClient === dbClient &&
      previous.signingFingerprint === signingFingerprint
    ) {
      rootBootstrap.dispatch({ type: "wanted", attempt: previous });
      return;
    }
    rootBootstrap.dispatch({
      type: "start",
      attempt: { scope, dbClient, signingFingerprint, signIn },
    });
  }, [
    dbStatus,
    dbClient,
    containerId,
    logError,
    rootBootstrap,
    scope,
    signIn,
    signingFingerprint,
    tearleads,
  ]);
}
